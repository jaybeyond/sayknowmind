/**
 * DELETE /api/integrations/connectors/:provider/accounts/:accountId
 *
 * Disconnects a single connected account: best-effort revoke at the
 * provider, then delete the row in user_integration_tokens. The user can
 * reconnect at any time via the OAuth start route.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { getConnector } from "@/lib/integrations/connectors/registry";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ provider: string; accountId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider, accountId } = await context.params;
  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  await connector.disconnect({ userId: session.user.id, accountId });
  return NextResponse.json({ ok: true });
}
