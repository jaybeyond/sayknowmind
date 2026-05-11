/**
 * GET /api/integrations/connectors/:provider/oauth/callback?code=&state=
 *
 * The OAuth callback. Verifies the signed state, checks that the userId in
 * the state matches the currently logged-in user (defense-in-depth), then
 * exchanges the code for tokens through the connector. Tokens are stored
 * encrypted under (userId, provider, accountId).
 *
 * On success, redirects back to the integrations settings tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { getConnector } from "@/lib/integrations/connectors/registry";
import { verifyState } from "@/lib/integrations/connectors/_oauth-state";

function settingsRedirect(req: NextRequest, status: "ok" | "error", message?: string): NextResponse {
  const url = new URL("/settings", req.nextUrl.origin);
  url.searchParams.set("tab", "integrations");
  url.searchParams.set("connect", status);
  // URLSearchParams.set already percent-encodes; pass the raw message and
  // just bound its length so a giant provider error doesn't blow out the URL.
  if (message) url.searchParams.set("message", message.slice(0, 200));
  return NextResponse.redirect(url);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider } = await context.params;
  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    return settingsRedirect(req, "error", oauthError);
  }
  if (!code || !state) {
    return settingsRedirect(req, "error", "missing_code_or_state");
  }

  const verified = verifyState(state);
  if (!verified) {
    return settingsRedirect(req, "error", "invalid_state");
  }
  if (verified.userId !== session.user.id) {
    // Someone is trying to bind tokens to the wrong user. Refuse hard.
    return settingsRedirect(req, "error", "user_mismatch");
  }
  if (verified.provider !== connector.meta.id) {
    return settingsRedirect(req, "error", "provider_mismatch");
  }

  try {
    await connector.handleOAuthCallback({ userId: session.user.id, code });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "callback_failed";
    return settingsRedirect(req, "error", msg);
  }

  return settingsRedirect(req, "ok");
}
