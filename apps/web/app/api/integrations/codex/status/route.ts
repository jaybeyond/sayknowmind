/**
 * GET    /api/integrations/codex/status   — { ready, active }
 * POST   /api/integrations/codex/status   — activate Codex for the member (404 if not ready)
 * DELETE /api/integrations/codex/status   — deactivate
 *
 * "ready" reflects the local machine's Codex login (~/.codex/auth.json
 * present). Only meaningful in the desktop / Tauri sidecar build.
 *
 * "active" reflects the member's choice — we mirror it into the existing
 * `user_provider_configs` table (provider_id='codex') so downstream code
 * that already keys off that table (usage-limit, ai cascade) sees Codex
 * the same way it sees other providers.
 *
 * The placeholder we store in encrypted_api_key is irrelevant — Codex
 * does not use an API key. We use it only to satisfy the NOT NULL column.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { encryptForUser } from "@/lib/encryption";
import { getSession } from "@/lib/admin";
import { isCodexReady, invalidateCodexReadyCache } from "@/lib/codex";

// Per-user state; never cache. Without this Cloudflare in front of
// sayknowmind.ypai.click can serve a stale `active=false` to a webview
// whose user has activated Codex — the card then renders "Connect"
// while the cascade keeps using Codex anyway.
export const dynamic = "force-dynamic";

/** Standard no-cache headers for every response on this route. */
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

const PROVIDER_ID = "codex";
const PLACEHOLDER_PLAINTEXT = "codex-oauth";
// Leave empty so cloud-chat/cloud-ai's relay path does NOT push a
// --model arg to the CLI — Codex then falls back to its own default
// which is what the user's ChatGPT subscription actually backs.
// Previously this was "codex-default" which Codex CLI rejected with
// exit status 1 ("Unknown model: codex-default").
const PINNED_MODEL = "";
// Symbolic base URL — Codex CLI handles the real endpoint internally.
const PINNED_BASE_URL = "https://auth.openai.com";

async function isCodexActiveForUser(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT is_active FROM user_provider_configs
     WHERE user_id = $1 AND provider_id = $2`,
    [userId, PROVIDER_ID],
  );
  return result.rows[0]?.is_active === true;
}

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  invalidateCodexReadyCache();
  const ready = isCodexReady();
  const active = await isCodexActiveForUser(session.user.id);
  return NextResponse.json({ ready, active }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  invalidateCodexReadyCache();

  // Desktop builds (lite + full) probe Codex on the user's machine via the
  // Tauri `codex_status` invoke and forward the result here as
  // `clientReady`. The server only sees its own filesystem, which in cloud
  // mode never has ~/.codex/auth.json — trusting the client lets the
  // desktop flow activate without faking auth.json on the server.
  const body = (await request.json().catch(() => ({}))) as { clientReady?: boolean };
  const ready = body.clientReady === true || isCodexReady();
  if (!ready) {
    return NextResponse.json(
      { error: "Codex not authenticated on this machine — run `codex login` first." },
      { status: 412, headers: NO_STORE_HEADERS },
    );
  }

  const encrypted = encryptForUser(session.user.id, PLACEHOLDER_PLAINTEXT);
  await pool.query(
    `INSERT INTO user_provider_configs
       (user_id, provider_id, encrypted_api_key, model, base_url, is_active, extra_fields)
     VALUES ($1, $2, $3, $4, $5, true, '{}'::jsonb)
     ON CONFLICT (user_id, provider_id)
     DO UPDATE SET is_active = true, updated_at = NOW()`,
    [session.user.id, PROVIDER_ID, encrypted, PINNED_MODEL, PINNED_BASE_URL],
  );
  return NextResponse.json({ ready: true, active: true }, { headers: NO_STORE_HEADERS });
}

export async function DELETE() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  // Soft-deactivate: keep the row so we don't lose history, just flip the flag.
  await pool.query(
    `UPDATE user_provider_configs SET is_active = false, updated_at = NOW()
     WHERE user_id = $1 AND provider_id = $2`,
    [session.user.id, PROVIDER_ID],
  );
  invalidateCodexReadyCache();
  return NextResponse.json(
    { ready: isCodexReady(), active: false },
    { headers: NO_STORE_HEADERS },
  );
}
