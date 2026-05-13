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

async function isOcpActiveForUser(userId: string): Promise<boolean> {
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
  invalidateOcpHealthCache();
  const ready = await isOcpReady();
  const active = await isOcpActiveForUser(session.user.id);
  return NextResponse.json({ ready, active }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  // Two paths to obtain the API key we'll store:
  //   1. `clientKey` in the request body — the Tauri webview minted it
  //      locally via the provision_ocp_key invoke command. This is the
  //      lite-build path because the cloud server can't see OCP itself.
  //   2. No body — we're on the same machine as OCP, ask its admin
  //      endpoint directly via lib/ocp's provisionOcpKey().
  let body: { clientKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body optional */
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
    [session.user.id, PROVIDER_ID, encrypted, PINNED_MODEL, ocpBaseUrl()],
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
