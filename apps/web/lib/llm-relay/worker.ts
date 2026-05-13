/**
 * Webview-side LLM relay worker.
 *
 * Long-polls /api/llm-relay/poll. When the cloud has an OCP or Codex
 * LLM job for this user (server-side cloud-ai.ts / cloud-chat.ts routed
 * it here instead of fetching directly), executes the job via the
 * appropriate Tauri command and POSTs the result to
 * /api/llm-relay/respond. Reconnects with backoff on disconnect.
 *
 * Lifecycle:
 *   start() — kick off the loop. Idempotent (returns early if running).
 *   stop()  — abort current poll and prevent reconnect.
 *
 * Mount once at the top of the React tree so every browser tab the user
 * has open contributes a poller. Multiple tabs racing for the same job
 * is fine: the server's queue gives a job to exactly one poller.
 */

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriBridge {
  invoke?: TauriInvoke;
}

function bridge(): TauriBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriBridge }).__TAURI_INTERNALS__ ?? null;
}

interface RelayJob {
  id: string;
  provider: "ocp" | "codex";
  system: string;
  user: string;
  model: string | null;
}

const POLL_PATH = "/api/llm-relay/poll";
const RESPOND_PATH = "/api/llm-relay/respond";

let running = false;
let stopFlag = false;
let currentAbort: AbortController | null = null;
let backoffMs = 0;
const BACKOFF_MAX = 30_000;

async function executeJob(job: RelayJob): Promise<{ content?: string; model?: string; error?: string }> {
  const b = bridge();
  if (!b?.invoke) {
    return { error: "Tauri bridge unavailable" };
  }
  const cmd = job.provider === "ocp" ? "complete_via_ocp" : "complete_via_codex";
  try {
    const reply = await b.invoke<{ content: string; model: string }>(cmd, {
      system: job.system,
      user: job.user,
      model: job.model ?? null,
    });
    if (!reply?.content) {
      return { error: `${cmd} returned empty content` };
    }
    return { content: reply.content, model: reply.model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

async function respond(jobId: string, payload: { content?: string; model?: string; error?: string }): Promise<void> {
  try {
    await fetch(RESPOND_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId, ...payload }),
      // No abort signal — respond should complete even if we're stopping.
    });
  } catch (err) {
    // Network died between poll and respond. The cloud-side waiter will
    // hit its own timeout; nothing more we can do here.
    console.warn("[llm-relay/worker] respond failed:", err);
  }
}

async function loop(): Promise<void> {
  while (!stopFlag) {
    currentAbort = new AbortController();
    let job: RelayJob | null = null;
    try {
      const res = await fetch(POLL_PATH, {
        signal: currentAbort.signal,
        // Tell the browser this is a long-poll so it doesn't time out
        // aggressively. Default fetch has no client-side timeout.
        cache: "no-store",
      });
      if (res.status === 204) {
        // Empty window — reconnect immediately, reset backoff.
        backoffMs = 0;
        continue;
      }
      if (res.status === 401) {
        // Not logged in — wait and try again so login state can change.
        backoffMs = Math.min(BACKOFF_MAX, Math.max(5_000, backoffMs * 2 || 5_000));
        await sleep(backoffMs, currentAbort.signal);
        continue;
      }
      if (!res.ok) {
        backoffMs = Math.min(BACKOFF_MAX, Math.max(2_000, backoffMs * 2 || 2_000));
        await sleep(backoffMs, currentAbort.signal);
        continue;
      }
      const data = (await res.json()) as { job?: RelayJob };
      job = data.job ?? null;
      backoffMs = 0;
    } catch (err) {
      if (stopFlag) break;
      // AbortError is normal during stop() — anything else means flaky
      // network; back off so we don't hammer.
      if ((err as { name?: string }).name !== "AbortError") {
        backoffMs = Math.min(BACKOFF_MAX, Math.max(2_000, backoffMs * 2 || 2_000));
        await sleep(backoffMs, currentAbort?.signal);
      }
      continue;
    }
    if (!job) continue;

    // Execute and respond in the background so we can immediately
    // re-poll for the next job. The cloud-side queue serves one job
    // per poll, but a busy user may need parallelism.
    void (async () => {
      const payload = await executeJob(job);
      await respond(job.id, payload);
    })();
  }
  running = false;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** Start the relay worker. Safe to call multiple times — no-op if running. */
export function startRelayWorker(): void {
  if (running) return;
  if (!bridge()?.invoke) return; // Not inside Tauri — nothing to relay.
  running = true;
  stopFlag = false;
  void loop();
}

/** Stop the worker. Aborts the in-flight poll and prevents reconnect. */
export function stopRelayWorker(): void {
  stopFlag = true;
  currentAbort?.abort();
}

export function isRelayWorkerRunning(): boolean {
  return running;
}
