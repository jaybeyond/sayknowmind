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
import { CODEX_DEFAULT_MODEL, normalizeCodexModel } from "@/lib/codex-models";

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
const PINNED_MODEL = CODEX_DEFAULT_MODEL;
// Symbolic base URL — Codex CLI handles the real endpoint internally.
const PINNED_BASE_URL = "https://auth.openai.com";

/** Reads is_active + current model in one round-trip. */
async function getCodexStateForUser(userId: string): Promise<{ active: boolean; model: string }> {
  const result = await pool.query(
    `SELECT is_active, model FROM user_provider_configs
     WHERE user_id = $1 AND provider_id = $2`,
    [userId, PROVIDER_ID],
  );
  const row = result.rows[0];
  return {
    active: row?.is_active === true,
    // Empty string means "let the Codex CLI pick" — that's the default
    // we keep for the relay path so `--model` isn't forwarded.
    model: normalizeCodexModel(row?.model),
  };
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
  const { active, model } = await getCodexStateForUser(session.user.id);
  return NextResponse.json({ ready, active, model }, { headers: NO_STORE_HEADERS });
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

  // Desktop builds probe Codex via the Tauri `codex_status` invoke and
  // forward the result here as `clientReady`. The cloud server never has
  // ~/.codex/auth.json in lite mode, so trusting the client lets the
  // desktop flow activate without faking auth.json on the server.
  //
  // Body fields:
  //   * clientReady  — boolean, see above
  //   * model        — optional override; empty string means "let CLI pick"
  //   * modelOnly    — if true, only patch the model column on an
  //                    already-active row; skip the readiness check and
  //                    leave is_active alone.
  const body = (await request
    .json()
    .catch(() => ({}))) as { clientReady?: boolean; model?: string; modelOnly?: boolean };

  // `model` may be intentionally empty (means "let Codex CLI pick"), so
  // we distinguish "field present" from "field missing" via typeof.
  const requestedModel = typeof body.model === "string" ? normalizeCodexModel(body.model) : null;

  if (body.modelOnly === true) {
    if (requestedModel === null) {
      return NextResponse.json(
        { error: "model is required when modelOnly=true" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const result = await pool.query(
      `UPDATE user_provider_configs SET model = $1, updated_at = NOW()
       WHERE user_id = $2 AND provider_id = $3
       RETURNING is_active, model`,
      [requestedModel, session.user.id, PROVIDER_ID],
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Codex not activated for this user — connect before changing model." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { ready: isCodexReady(), active: result.rows[0].is_active === true, model: result.rows[0].model },
      { headers: NO_STORE_HEADERS },
    );
  }

  const ready = body.clientReady === true || isCodexReady();
  if (!ready) {
    return NextResponse.json(
      { error: "Codex not authenticated on this machine — run `codex login` first." },
      { status: 412, headers: NO_STORE_HEADERS },
    );
  }

  const modelToStore = requestedModel !== null ? requestedModel : PINNED_MODEL;
  const encrypted = encryptForUser(session.user.id, PLACEHOLDER_PLAINTEXT);
  await pool.query(
    `INSERT INTO user_provider_configs
       (user_id, provider_id, encrypted_api_key, model, base_url, is_active, extra_fields)
     VALUES ($1, $2, $3, $4, $5, true, '{}'::jsonb)
     ON CONFLICT (user_id, provider_id)
     DO UPDATE SET model = EXCLUDED.model, is_active = true, updated_at = NOW()`,
    [session.user.id, PROVIDER_ID, encrypted, modelToStore, PINNED_BASE_URL],
  );
  return NextResponse.json(
    { ready: true, active: true, model: modelToStore },
    { headers: NO_STORE_HEADERS },
  );
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
