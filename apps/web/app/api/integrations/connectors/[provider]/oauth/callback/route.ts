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
  const { provider } = await context.params;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");
  const cookieHeader = req.headers.get("cookie") ?? "";
  // Don't log cookie values, just the set of names so we can tell if
  // the better-auth session cookie even reached us.
  const cookieNames = cookieHeader
    .split(/;\s*/)
    .map((c) => c.split("=")[0])
    .filter(Boolean)
    .join(",");

  const session = await getSession();
  console.log(
    `[oauth/callback] provider=${provider} ` +
      `hasCode=${Boolean(code)} hasState=${Boolean(state)} ` +
      `oauthError=${oauthError ?? "none"} ` +
      `session=${session?.user?.id ? `userid=${session.user.id}` : "MISSING"} ` +
      `cookies=[${cookieNames}] ` +
      `ua=${(req.headers.get("user-agent") ?? "").slice(0, 80)}`,
  );

  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  if (oauthError) {
    console.warn(`[oauth/callback] google reported oauthError=${oauthError}`);
    return settingsRedirect(req, "error", oauthError);
  }
  if (!code || !state) {
    console.warn(`[oauth/callback] missing_code_or_state hasCode=${Boolean(code)} hasState=${Boolean(state)}`);
    return settingsRedirect(req, "error", "missing_code_or_state");
  }

  const verified = verifyState(state);
  if (!verified) {
    console.warn(`[oauth/callback] state verification failed (bad signature or expiry)`);
    return settingsRedirect(req, "error", "invalid_state");
  }
  if (verified.provider !== connector.meta.id) {
    console.warn(`[oauth/callback] provider_mismatch state.provider=${verified.provider} route.provider=${connector.meta.id}`);
    return settingsRedirect(req, "error", "provider_mismatch");
  }

  // Authentication priority:
  //   1. browser session cookie (normal flow). MUST match state.userId.
  //   2. state-only (desktop external-browser flow). The state is HMAC-
  //      signed with BETTER_AUTH_SECRET and TTL'd to 10 min by
  //      _oauth-state.ts, so trusting state.userId when no session is
  //      present lets the desktop app's external-browser flow work
  //      without forcing the user to log in twice.
  let userId: string;
  if (session?.user?.id) {
    if (verified.userId !== session.user.id) {
      console.warn(`[oauth/callback] user_mismatch state.userId=${verified.userId} session.userId=${session.user.id}`);
      return settingsRedirect(req, "error", "user_mismatch");
    }
    userId = session.user.id;
  } else {
    console.log(`[oauth/callback] no session — authenticating via signed state, userId=${verified.userId}`);
    userId = verified.userId;
  }

  try {
    console.log(`[oauth/callback] exchanging code for tokens via connector ${connector.meta.id} for userId=${userId}`);
    await connector.handleOAuthCallback({ userId, code });
    console.log(`[oauth/callback] tokens stored for user=${userId} provider=${connector.meta.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "callback_failed";
    console.error(`[oauth/callback] handleOAuthCallback threw: ${msg}`);
    return settingsRedirect(req, "error", msg);
  }

  return settingsRedirect(req, "ok");
}
