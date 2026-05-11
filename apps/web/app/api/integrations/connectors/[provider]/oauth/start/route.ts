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
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider } = await context.params;
  const connector = getConnector(provider);
  if (!connector) {
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
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "oauth_start_failed";
    return settingsError(req, msg);
  }
}
