/**
 * Private Mode - Network Isolation & Local Data Storage
 *
 * Privacy hierarchy (top wins):
 *   1. PRIVATE_MODE=true (global) → forces everything private
 *   2. Document.privacyLevel (per-document override)
 *   3. Category.privacyLevel (inherited default for new documents)
 *   4. System default: 'private'
 *
 * When PRIVATE_MODE=true:
 * - All outbound network connections are blocked except Tailscale/Syncthing
 * - No telemetry data is collected or transmitted
 * - LLM calls go to local Ollama only
 * - All data stays in local Docker volumes
 */

import type { PrivacyLevel } from "@/lib/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function isPrivateMode(): boolean {
  return process.env.PRIVATE_MODE === "true";
}

// Allowed hosts in Private Mode
const PRIVATE_MODE_ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "host.docker.internal",
  // Docker service names
  "postgres",
  "ollama",
  "edgequake",
  "ai-server",
  "mcp-server",
  "searxng",
  // Tailscale
  "100.64.0.0/10", // Tailscale CGNAT range
  // Syncthing
  "syncthing",
]);

// Blocked telemetry domains
const TELEMETRY_DOMAINS = new Set([
  "analytics.google.com",
  "www.google-analytics.com",
  "stats.g.doubleclick.net",
  "sentry.io",
  "o0.ingest.sentry.io",
  "segment.io",
  "api.segment.io",
  "mixpanel.com",
  "api.mixpanel.com",
  "amplitude.com",
  "api.amplitude.com",
  "plausible.io",
  "telemetry.nextjs.org",
]);

// ---------------------------------------------------------------------------
// Network Guard
// ---------------------------------------------------------------------------

/**
 * Check if a URL is allowed in Private Mode.
 * Returns true if the request should be allowed.
 */
export function isAllowedInPrivateMode(url: string): boolean {
  if (!isPrivateMode()) return true;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Allow localhost and Docker internal hosts
    if (PRIVATE_MODE_ALLOWED_HOSTS.has(hostname)) return true;

    // Allow Tailscale IPs (100.x.x.x)
    if (hostname.startsWith("100.")) return true;

    // Allow local network (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a domain is a known telemetry endpoint.
 */
export function isTelemetryDomain(hostname: string): boolean {
  return TELEMETRY_DOMAINS.has(hostname);
}

/**
 * Guarded fetch that respects Private Mode restrictions.
 * Throws an error if the URL is not allowed in Private Mode.
 */
export async function privateFetch(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

  if (!isAllowedInPrivateMode(urlStr)) {
    throw new PrivateModeError(
      `Blocked by Private Mode: ${urlStr}. Only local and Tailscale connections are allowed.`,
    );
  }

  try {
    const parsed = new URL(urlStr);
    if (isTelemetryDomain(parsed.hostname)) {
      throw new PrivateModeError(
        `Telemetry blocked in Private Mode: ${parsed.hostname}`,
      );
    }
  } catch (e) {
    if (e instanceof PrivateModeError) throw e;
  }

  return fetch(url, init);
}

// ---------------------------------------------------------------------------
// Local LLM Configuration
// ---------------------------------------------------------------------------

/**
 * Get the LLM endpoint URL. In Private Mode, always use local Ollama.
 */
export function getLLMEndpoint(): string {
  if (isPrivateMode()) {
    return process.env.OLLAMA_URL ?? "http://localhost:11434";
  }
  return process.env.AI_SERVER_URL ?? "http://localhost:4000";
}

/**
 * Get the LLM model name for Private Mode (local models only).
 */
export function getLLMModel(): string {
  if (isPrivateMode()) {
    return process.env.LLM_MODEL ?? "Qwen/Qwen3.5-0.8B";
  }
  return process.env.LLM_MODEL ?? "gpt-4o-mini";
}

// ---------------------------------------------------------------------------
// Per-Document / Per-Category Privacy Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective privacy level for a document.
 *
 * Priority:
 *   1. Global PRIVATE_MODE=true → always 'private'
 *   2. Document-level privacyLevel (explicit override)
 *   3. Category-level privacyLevel (inherited default)
 *   4. System default: 'private'
 */
export function resolveDocumentPrivacy(
  documentPrivacyLevel?: PrivacyLevel,
  categoryPrivacyLevel?: PrivacyLevel,
): PrivacyLevel {
  if (isPrivateMode()) return "private";
  if (documentPrivacyLevel) return documentPrivacyLevel;
  if (categoryPrivacyLevel) return categoryPrivacyLevel;
  return "private";
}

/**
 * Resolve the effective privacy level for a category.
 */
export function resolveCategoryPrivacy(
  categoryPrivacyLevel?: PrivacyLevel,
): PrivacyLevel {
  if (isPrivateMode()) return "private";
  return categoryPrivacyLevel ?? "private";
}

/**
 * Check if a document can be shared based on its resolved privacy level.
 */
export function canShare(
  documentPrivacyLevel?: PrivacyLevel,
  categoryPrivacyLevel?: PrivacyLevel,
): boolean {
  return resolveDocumentPrivacy(documentPrivacyLevel, categoryPrivacyLevel) === "shared";
}

// ---------------------------------------------------------------------------
// Data Storage Verification
// ---------------------------------------------------------------------------

/**
 * Verify that data is only stored locally (Docker volumes).
 * Returns storage info for diagnostics.
 */
export function getStorageInfo(): {
  mode: "private" | "standard";
  dataDir: string;
  dbHost: string;
  externalConnections: boolean;
} {
  const mode = isPrivateMode() ? "private" : "standard";
  const dataDir = process.env.DATA_DIR ?? "./data";
  const dbUrl = process.env.DATABASE_URL ?? "postgres://localhost:5432/sayknowmind";
  let dbHost = "localhost";
  try {
    dbHost = new URL(dbUrl.replace("postgres://", "http://")).hostname;
  } catch { /* ignore */ }

  return {
    mode,
    dataDir,
    dbHost,
    externalConnections: !isPrivateMode(),
  };
}

// ---------------------------------------------------------------------------
// Private Mode Error
// ---------------------------------------------------------------------------

export class PrivateModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateModeError";
  }
}

// ---------------------------------------------------------------------------
// DNS Block List (for Docker network-level enforcement)
// ---------------------------------------------------------------------------

/**
 * Generate iptables-compatible blocked domain list for Docker.
 * Used by install.sh to configure network rules in Private Mode.
 */
export function getBlockedDomains(): string[] {
  return [...TELEMETRY_DOMAINS];
}

/**
 * Get Private Mode status summary for health check endpoints.
 */
export function getPrivateModeStatus(): {
  enabled: boolean;
  llmEndpoint: string;
  llmModel: string;
  storageMode: string;
  telemetryBlocked: boolean;
} {
  return {
    enabled: isPrivateMode(),
    llmEndpoint: getLLMEndpoint(),
    llmModel: getLLMModel(),
    storageMode: isPrivateMode() ? "local-only" : "standard",
    telemetryBlocked: isPrivateMode(),
  };
}
