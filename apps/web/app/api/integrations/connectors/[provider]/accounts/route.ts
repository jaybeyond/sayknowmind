/**
 * GET /api/integrations/connectors/:provider/accounts
 *
 * Lists every connected account the *current user* has at this provider.
 * Returns only metadata (no tokens) — display-safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { getConnector } from "@/lib/integrations/connectors/registry";
import { listAccounts } from "@/lib/integrations/connectors/_token-store";

export async function GET(
  _req: NextRequest,
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

  const accounts = await listAccounts({
    userId: session.user.id,
    provider: connector.meta.id,
  });
  return NextResponse.json({ provider: connector.meta.id, accounts });
}
