/**
 * GET /api/integrations/connectors
 *
 * Returns the catalogue of cloud connectors the server knows how to talk
 * to, plus how many of the *current user's* accounts are connected at
 * each. The UI uses this to render the "Integrations" page.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { listConnectors } from "@/lib/integrations/connectors/registry";
import { listAccounts } from "@/lib/integrations/connectors/_token-store";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connectors = listConnectors();
  const enriched = await Promise.all(
    connectors.map(async (c) => {
      const accounts = await listAccounts({
        userId: session.user.id,
        provider: c.meta.id,
      });
      return {
        ...c.meta,
        connectedAccountCount: accounts.length,
        accounts,
      };
    }),
  );

  return NextResponse.json({ connectors: enriched });
}
