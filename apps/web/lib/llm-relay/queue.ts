/**
 * In-memory LLM relay queue.
 *
 * Bridges cloud-side LLM calls to a user's local OCP/Codex via their
 * running webview. The cloud `callCloudProvider()` enqueues a job here
 * and awaits the result; the webview long-polls /api/llm-relay/poll,
 * runs the request through Tauri (OCP HTTP or Codex CLI), and POSTs the
 * result to /api/llm-relay/respond which resolves the original awaiter.
 *
 * Why in-memory: cloud lives on a single EC2 host running docker
 * compose (see deploy/helm and docker-compose.yml). One process, one
 * queue, no horizontal scaling concerns. Persistence is unnecessary —
 * if the cloud restarts mid-flight, the job just times out and the
 * cloud-ai cascade falls through to the next provider.
 *
 * Auth boundary: every operation takes a userId. A user can only see
 * their own jobs; the HTTP layer enforces this via getUserIdFromRequest.
 */

import { randomUUID } from "node:crypto";

export type RelayProvider = "ocp" | "codex";

export interface RelayJobRequest {
  /** Mirror the OpenAI chat/completions shape so callers don't need to
   * transform — the webview proxies to Tauri's complete_via_*. */
  system: string;
  user: string;
  model: string | null;
  provider: RelayProvider;
}

export interface RelayJobResult {
  /** Final assistant text. */
  content: string;
  /** Echoes the model the local LLM reported (e.g. claude-opus-4-7). */
  model: string;
}

interface PendingJob {
  id: string;
  userId: string;
  request: RelayJobRequest;
  /** Resolved when the webview POSTs to /api/llm-relay/respond. */
  resolve: (r: RelayJobResult) => void;
  /** Rejected on timeout or explicit error from the webview. */
  reject: (err: Error) => void;
  /** When the job was enqueued — used for stale cleanup. */
  enqueuedAt: number;
}

interface PendingPoller {
  userId: string;
  resolve: (job: PendingJob | null) => void;
  /** Set when the long-poll abort signal fires so we drop the poller. */
  cancelled: boolean;
}

const JOB_TTL_MS = 5 * 60 * 1000;  // 5 min — abandoned jobs get GC'd
const POLL_MAX_MS = 25 * 1000;     // 25s — under most CDN/proxy idle limits

/** All jobs awaiting a webview to pick them up. */
const jobsByUser = new Map<string, PendingJob[]>();

/** All long-polls waiting for a job to enqueue. */
const pollersByUser = new Map<string, PendingPoller[]>();

/** Active jobs that have been claimed by a poller but not yet responded. */
const inFlight = new Map<string, PendingJob>();

function purgeStale(): void {
  const now = Date.now();
  for (const [id, job] of inFlight) {
    if (now - job.enqueuedAt > JOB_TTL_MS) {
      inFlight.delete(id);
      job.reject(new Error("llm-relay: job timed out after 5min in-flight"));
    }
  }
  for (const [userId, queue] of jobsByUser) {
    const fresh = queue.filter((j) => {
      if (now - j.enqueuedAt > JOB_TTL_MS) {
        j.reject(new Error("llm-relay: job timed out unclaimed for 5min"));
        return false;
      }
      return true;
    });
    if (fresh.length === 0) jobsByUser.delete(userId);
    else jobsByUser.set(userId, fresh);
  }
}

// Periodic sweep so a queue leak can't accumulate forever. setInterval
// returns immediately and the GC keeps the closure alive while the
// process runs. unref() lets node exit if nothing else holds the loop.
const sweepTimer = setInterval(purgeStale, 30 * 1000);
if (typeof sweepTimer.unref === "function") sweepTimer.unref();

/**
 * Enqueue a job and resolve when a webview returns a result. Throws on
 * timeout — the caller (callCloudProvider) then catches and the cascade
 * moves on to the next provider, matching the existing fallback shape.
 */
export function enqueueAndWait(
  userId: string,
  request: RelayJobRequest,
  timeoutMs: number,
): Promise<RelayJobResult> {
  return new Promise<RelayJobResult>((resolve, reject) => {
    const job: PendingJob = {
      id: randomUUID(),
      userId,
      request,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    };

    // Hand it directly to a waiting poller if there's one — saves a
    // poll round-trip. Otherwise queue it and let the next poll claim.
    const polls = pollersByUser.get(userId);
    if (polls && polls.length > 0) {
      const p = polls.shift()!;
      if (polls.length === 0) pollersByUser.delete(userId);
      else pollersByUser.set(userId, polls);
      if (!p.cancelled) {
        inFlight.set(job.id, job);
        p.resolve(job);
      } else {
        // Cancelled poller — fall through to normal enqueue.
        const q = jobsByUser.get(userId) ?? [];
        q.push(job);
        jobsByUser.set(userId, q);
      }
    } else {
      const q = jobsByUser.get(userId) ?? [];
      q.push(job);
      jobsByUser.set(userId, q);
    }

    // Per-job timeout — distinct from the global TTL sweep. Callers like
    // callCloudProvider pass their own (e.g. 60s for summary, 180s for
    // streaming chat) so we honour that and reject sooner.
    const t = setTimeout(() => {
      // Remove from the queue if still waiting (not yet picked up).
      const q = jobsByUser.get(userId);
      if (q) {
        const idx = q.findIndex((j) => j.id === job.id);
        if (idx >= 0) {
          q.splice(idx, 1);
          if (q.length === 0) jobsByUser.delete(userId);
        }
      }
      inFlight.delete(job.id);
      reject(new Error(`llm-relay: timed out after ${timeoutMs}ms waiting for local LLM`));
    }, timeoutMs);
    if (typeof t.unref === "function") t.unref();
  });
}

/**
 * Long-poll for the next job for a user. Resolves with a job (which the
 * caller serializes and sends back to the webview), or null if the
 * window expires without one — webview reconnects immediately on null.
 *
 * `signal` lets the HTTP layer cancel the poll when the client
 * disconnects, so we don't sit forever on a dead connection.
 */
export function pollNextJob(
  userId: string,
  signal: AbortSignal,
): Promise<PendingJob | null> {
  return new Promise<PendingJob | null>((resolve) => {
    // Drain any job that's already queued for this user before parking.
    const q = jobsByUser.get(userId);
    if (q && q.length > 0) {
      const job = q.shift()!;
      if (q.length === 0) jobsByUser.delete(userId);
      else jobsByUser.set(userId, q);
      inFlight.set(job.id, job);
      resolve(job);
      return;
    }

    const poller: PendingPoller = { userId, resolve, cancelled: false };
    const list = pollersByUser.get(userId) ?? [];
    list.push(poller);
    pollersByUser.set(userId, list);

    const finish = (job: PendingJob | null) => {
      if (poller.cancelled) return;
      poller.cancelled = true;
      const remaining = pollersByUser.get(userId);
      if (remaining) {
        const idx = remaining.indexOf(poller);
        if (idx >= 0) remaining.splice(idx, 1);
        if (remaining.length === 0) pollersByUser.delete(userId);
      }
      resolve(job);
    };

    // Empty-window timeout: webview reconnects so this is cheap.
    const t = setTimeout(() => finish(null), POLL_MAX_MS);
    if (typeof t.unref === "function") t.unref();

    // Abort if the HTTP client (webview) goes away mid-poll.
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      finish(null);
    }, { once: true });
  });
}

/**
 * Webview finished a job — resolve the awaiting enqueueAndWait caller.
 * Returns true if we owned the job, false if it was unknown/expired so
 * the HTTP layer can 404 cleanly.
 */
export function completeJob(
  userId: string,
  jobId: string,
  result: RelayJobResult,
): boolean {
  const job = inFlight.get(jobId);
  if (!job || job.userId !== userId) return false;
  inFlight.delete(jobId);
  job.resolve(result);
  return true;
}

/** Webview reports an error — propagate to the awaiter as a normal failure. */
export function failJob(
  userId: string,
  jobId: string,
  message: string,
): boolean {
  const job = inFlight.get(jobId);
  if (!job || job.userId !== userId) return false;
  inFlight.delete(jobId);
  job.reject(new Error(`llm-relay: webview reported error: ${message}`));
  return true;
}

/** True iff the user has at least one polling webview attached right now. */
export function hasActiveWebview(userId: string): boolean {
  const polls = pollersByUser.get(userId);
  return Boolean(polls && polls.length > 0);
}
