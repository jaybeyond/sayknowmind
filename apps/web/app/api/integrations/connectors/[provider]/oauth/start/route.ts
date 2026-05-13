/**
 * GET /api/integrations/connectors/:provider/oauth/start
 *
 * Builds the provider's OAuth URL bound to the current logged-in user and
 * redirects there. The state parameter is signed with BETTER_AUTH_SECRET so
 * the callback can verify it was issued for *this* user.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { getConnector } from "@/lib/integrations/connectors/registry";
import { signState } from "@/lib/integrations/connectors/_oauth-state";

function settingsError(req: NextRequest, message: string): NextResponse {
  const url = new URL("/settings", req.nextUrl.origin);
  url.searchParams.set("tab", "integrations");
  url.searchParams.set("connect", "error");
  url.searchParams.set("message", message.slice(0, 200));
  return NextResponse.redirect(url);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const session = await getSession();
  console.log(
    `[oauth/start] provider=${provider} ` +
      `session=${session?.user?.id ? `userid=${session.user.id}` : "MISSING"} ` +
      `ua=${(req.headers.get("user-agent") ?? "").slice(0, 80)}`,
  );
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connector = getConnector(provider);
  if (!connector) {
    console.warn(`[oauth/start] unknown provider: ${provider}`);
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  // buildAuthUrl can throw if the server's OAuth credentials are missing.
  // Send the user back to settings with a readable error instead of a 500.
  try {
    const state = signState({
      userId: session.user.id,
      provider: connector.meta.id,
    });
    const url = connector.buildAuthUrl({ userId: session.user.id, state });

    // Desktop mode: the Tauri webview can't reliably render Google's
    // consent JS (the post-allow redirect never reflows), so the client
    // calls start with ?desktop=1 to fetch the URL and open it in the
    // user's system browser instead. We hand the URL back as JSON.
    if (req.nextUrl.searchParams.get("desktop") === "1") {
      console.log(`[oauth/start] desktop mode — returning authUrl JSON`);
      return NextResponse.json({ authUrl: url, state });
    }

    console.log(`[oauth/start] redirecting to ${url.slice(0, 140)}...`);
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "oauth_start_failed";
    console.error(`[oauth/start] buildAuthUrl failed: ${msg}`);
    return settingsError(req, msg);
  }
}
