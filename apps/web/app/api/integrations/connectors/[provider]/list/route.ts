/**
 * GET /api/integrations/connectors/:provider/list
 *   ?accountId=...&parentId=...&cursor=...&pageSize=50
 *
 * Browse the user's content at the provider. Always uses the user's own
 * token; the server has no way to list anyone else's data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { getConnector } from "@/lib/integrations/connectors/registry";
import { pool } from "@/lib/db";

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

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }
  const parentId = req.nextUrl.searchParams.get("parentId") ?? undefined;
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const pageSizeRaw = req.nextUrl.searchParams.get("pageSize");
  const pageSize = pageSizeRaw ? Math.max(1, Math.min(1000, Number(pageSizeRaw))) : undefined;

  // Pass through any filter[<key>]= params verbatim to the connector. Each
  // connector decides which keys it understands. Repeated keys become arrays.
  const filters: Record<string, string | string[]> = {};
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    const m = key.match(/^filter\[(.+)\]$/);
    if (!m) continue;
    const fk = m[1];
    if (filters[fk] === undefined) {
      filters[fk] = value;
    } else if (Array.isArray(filters[fk])) {
      (filters[fk] as string[]).push(value);
    } else {
      filters[fk] = [filters[fk] as string, value];
    }
  }

  try {
    const page = await connector.list({
      userId: session.user.id,
      accountId,
      parentId,
      cursor,
      pageSize,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    });

    // Annotate items the user has already imported so the UI can show a
    // badge and skip re-selection. We only check files (folders aren't
    // imported), and only when there are any to ask about.
    const fileIds = page.items
      .filter((it) => it.kind === "file")
      .map((it) => it.externalId);
    if (fileIds.length > 0) {
      const dup = await pool.query(
        `SELECT external_id, document_id
         FROM user_integration_imports
         WHERE user_id = $1 AND provider = $2 AND account_id = $3
           AND external_id = ANY($4::text[])`,
        [session.user.id, connector.meta.id, accountId, fileIds],
      );
      const rows = dup.rows as Array<{ external_id: string; document_id: string | null }>;
      const importedById = new Map<string, string | null>(
        rows.map((r) => [r.external_id, r.document_id]),
      );
      for (const item of page.items) {
        const docId = importedById.get(item.externalId);
        if (docId !== undefined) {
          item.alreadyImported = true;
          if (docId) item.importedDocumentId = docId;
        }
      }
    }

    return NextResponse.json(page);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "list_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
