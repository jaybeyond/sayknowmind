/**
 * OCP (Open Claude Proxy) client.
 *
 * OCP runs on the user's machine at http://localhost:3456 and exposes an
 * OpenAI-compatible API backed by their Claude Pro/Max subscription. We
 * detect it server-side (so dev/desktop builds work transparently) and
 * provision a SayKnowMind-scoped API key on demand using the admin token
 * that OCP writes to `~/.ocp/admin-key`.
 *
 * As with Codex, this is meaningful only when the Next.js server is on
 * the same host as the user (dev / Tauri sidecar). A multi-tenant cloud
 * deployment will see at most one OCP instance shared across all members.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_HOST = process.env.OCP_HOST ?? "127.0.0.1";
const DEFAULT_PORT = Number(process.env.OCP_PORT ?? 3456);
const ADMIN_KEY_FILE = join(homedir(), ".ocp", "admin-key");
const PROVISIONED_KEY_NAME = "sayknowmind";

let cachedHealth: boolean | null = null;
let cachedHealthAt = 0;
const HEALTH_TTL_MS = 5_000;

export function ocpBaseUrl(): string {
  return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
}

/** OpenAI-compatible base URL — what we hand to the LLM client. */
export function ocpOpenAIBaseUrl(): string {
  return `${ocpBaseUrl()}/v1`;
}

/** Returns the admin key if the file exists, else null. */
function readAdminKey(): string | null {
  try {
    if (!existsSync(ADMIN_KEY_FILE)) return null;
    const raw = readFileSync(ADMIN_KEY_FILE, "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Pings the proxy. Cached for 5s to keep status polling cheap. The cache
 * is invalidated by `invalidateOcpHealthCache()` after activate/deactivate.
 */
export async function isOcpHealthy(): Promise<boolean> {
  const now = Date.now();
  if (cachedHealth !== null && now - cachedHealthAt < HEALTH_TTL_MS) {
    return cachedHealth;
  }
  try {
    const res = await fetch(`${ocpBaseUrl()}/health`, {
      // Health endpoint is public; small explicit timeout so unreachable
      // OCP doesn't stall the settings page.
      signal: AbortSignal.timeout(1500),
    });
    cachedHealth = res.ok;
  } catch {
    cachedHealth = false;
  }
  cachedHealthAt = now;
  return cachedHealth;
}

export function invalidateOcpHealthCache(): void {
  cachedHealth = null;
}

/** True when OCP is reachable AND we can read its admin key from disk. */
export async function isOcpReady(): Promise<boolean> {
  if (!readAdminKey()) return false;
  return isOcpHealthy();
}

interface OcpKey {
  id: number;
  key?: string; // present only on POST /api/keys responses
  name: string;
  created_at?: string;
  revoked?: number;
}

/**
 * Provision (or reuse) a SayKnowMind-named API key against the running
 * OCP instance. Returns the plaintext key — the caller is responsible
 * for encrypting it before storage.
 */
export async function provisionOcpKey(): Promise<string> {
  const adminKey = readAdminKey();
  if (!adminKey) throw new Error("OCP admin-key file not found at ~/.ocp/admin-key");

  // OCP /api/keys POST issues a fresh per-name key. If a key named
  // PROVISIONED_KEY_NAME already exists, OCP returns a 409-style error;
  // we just revoke it first and re-issue so we always own the plaintext.
  await revokeProvisionedKey().catch(() => {
    /* ignore — nothing to revoke is fine */
  });

  const res = await fetch(`${ocpBaseUrl()}/api/keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey}`,
    },
    body: JSON.stringify({ name: PROVISIONED_KEY_NAME }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OCP key provisioning failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as OcpKey;
  if (!data.key) {
    throw new Error("OCP responded with no plaintext key");
  }
  return data.key;
}

/** Revokes the SayKnowMind key (idempotent — silent if no such key). */
export async function revokeProvisionedKey(): Promise<void> {
  const adminKey = readAdminKey();
  if (!adminKey) return;
  // OCP DELETE /api/keys/:nameOrId resolves by name when not numeric.
  const res = await fetch(
    `${ocpBaseUrl()}/api/keys/${encodeURIComponent(PROVISIONED_KEY_NAME)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminKey}` },
    },
  );
  // 404 just means there was nothing to revoke; that's fine.
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`OCP key revoke failed (${res.status}): ${body}`);
  }
}
