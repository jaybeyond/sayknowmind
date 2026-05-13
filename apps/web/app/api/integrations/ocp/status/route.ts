/**
 * GET    /api/integrations/ocp/status   — { ready, active }
 * POST   /api/integrations/ocp/status   — auto-provision an OCP key + activate
 * DELETE /api/integrations/ocp/status   — revoke + deactivate
 *
 * Mirrors the Codex status route but the activation step actually mints a
 * fresh OCP API key (via the local admin-key file) and stores it encrypted
 * in `user_provider_configs`, so the ai-server can call OCP just like any
 * other OpenAI-compatible provider.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { encryptForUser } from "@/lib/encryption";
import { getSession } from "@/lib/admin";
import {
  isOcpReady,
  invalidateOcpHealthCache,
  ocpBaseUrl,
  provisionOcpKey,
  revokeProvisionedKey,
} from "@/lib/ocp";

// Per-user state, never cacheable. Without this, Cloudflare in front of
// sayknowmind.ypai.click will happily serve a stale `active=false` back
// to a webview whose user has actually activated OCP — UI then shows
// the "Connect" button while the backend cascade keeps routing to OCP.
export const dynamic = "force-dynamic";

const PROVIDER_ID = "ocp";
// OCP rejects bare aliases like "claude-opus" — its `/v1/models` lists
// concrete IDs. Pin to the most capable Opus revision; users wanting a
// different tier can override per-call (or via a future model picker).
const PINNED_MODEL = "claude-opus-4-7";

/** Standard no-cache headers for every response on this route. */
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

/** Reads is_active + current model in one round-trip. */
async function getOcpStateForUser(userId: string): Promise<{ active: boolean; model: string }> {
  const result = await pool.query(
    `SELECT is_active, model FROM user_provider_configs
     WHERE user_id = $1 AND provider_id = $2`,
    [userId, PROVIDER_ID],
  );
  const row = result.rows[0];
  return {
    active: row?.is_active === true,
    // Fall back to the pinned default when the row exists with an empty
    // model (legacy seed) or no row at all (user never activated).
    model: typeof row?.model === "string" && row.model.length > 0 ? row.model : PINNED_MODEL,
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
  invalidateOcpHealthCache();
  const ready = await isOcpReady();
  const { active, model } = await getOcpStateForUser(session.user.id);
  return NextResponse.json({ ready, active, model }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  // Three modes for POST:
  //   * `modelOnly: true` + `model` — patch the model column on an
  //     existing active row; no key rotation, no readiness check.
  //   * `clientKey` (no modelOnly) — full activation, key was minted
  //     locally by the Tauri webview (lite-desktop path).
  //   * neither — full activation, cloud server mints the key itself
  //     via its own admin-key file (only works when the cloud and
  //     OCP run on the same host).
  let body: { clientKey?: string; model?: string; modelOnly?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* body optional */
  }

  const requestedModel =
    typeof body.model === "string" && body.model.length > 0 ? body.model.slice(0, 200) : "";

  // Model-only update — used when the user changes the dropdown while
  // OCP is already active. Avoids re-provisioning the OCP API key.
  if (body.modelOnly === true) {
    if (!requestedModel) {
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
        { error: "OCP not activated for this user — connect before changing model." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { ready: true, active: result.rows[0].is_active === true, model: result.rows[0].model },
      { headers: NO_STORE_HEADERS },
    );
  }

  let key: string;
  if (body.clientKey && typeof body.clientKey === "string") {
    key = body.clientKey;
  } else {
    invalidateOcpHealthCache();
    if (!(await isOcpReady())) {
      return NextResponse.json(
        {
          error:
            "OCP not reachable on http://localhost:3456 or admin-key missing — install and start OCP first.",
        },
        { status: 412, headers: NO_STORE_HEADERS },
      );
    }
    try {
      key = await provisionOcpKey();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OCP provisioning failed";
      return NextResponse.json({ error: msg }, { status: 502, headers: NO_STORE_HEADERS });
    }
  }

  const modelToStore = requestedModel || PINNED_MODEL;
  const encrypted = encryptForUser(session.user.id, key);
  await pool.query(
    `INSERT INTO user_provider_configs
       (user_id, provider_id, encrypted_api_key, model, base_url, is_active, extra_fields)
     VALUES ($1, $2, $3, $4, $5, true, '{}'::jsonb)
     ON CONFLICT (user_id, provider_id)
     DO UPDATE SET
       encrypted_api_key = EXCLUDED.encrypted_api_key,
       model             = EXCLUDED.model,
       base_url          = EXCLUDED.base_url,
       is_active         = true,
       updated_at        = NOW()`,
    // Store the bare host (no /v1) so cloud-ai.ts/cloud-chat.ts append
    // /v1/chat/completions cleanly, matching the OpenRouter/OpenAI convention.
    [session.user.id, PROVIDER_ID, encrypted, modelToStore, ocpBaseUrl()],
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

  // Best-effort revoke the key at OCP so it can't be reused if leaked.
  // Failure here doesn't block local deactivation.
  await revokeProvisionedKey().catch(() => {
    /* swallow */
  });

  await pool.query(
    `UPDATE user_provider_configs SET is_active = false, updated_at = NOW()
     WHERE user_id = $1 AND provider_id = $2`,
    [session.user.id, PROVIDER_ID],
  );

  invalidateOcpHealthCache();
  const ready = await isOcpReady();
  return NextResponse.json({ ready, active: false }, { headers: NO_STORE_HEADERS });
}
