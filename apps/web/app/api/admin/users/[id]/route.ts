import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/admin";
import { deindexDocuments } from "@/lib/edgequake/client";
import { ensureEqDocumentIdColumn } from "@/lib/ingest/document-store";

/** GET /api/admin/users/[id] — Get user detail + recent 10 documents */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  try {
    await requireAdmin(session);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    const status = msg === "Unauthorized" ? 401 : 403;
    return NextResponse.json({ error: msg }, { status });
  }

  const { id } = await params;

  const userResult = await pool.query(
    `SELECT id, name, email, "emailVerified", image, role, "createdAt"
     FROM "user" WHERE id = $1`,
    [id],
  );
  if (userResult.rowCount === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const docsResult = await pool.query(
    `SELECT id, title, status, "createdAt"
     FROM documents
     WHERE user_id = $1
     ORDER BY "createdAt" DESC
     LIMIT 10`,
    [id],
  );

  return NextResponse.json({
    user: userResult.rows[0],
    recentDocuments: docsResult.rows,
  });
}

/** DELETE /api/admin/users/[id] — Delete user and all associated data */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  try {
    await requireAdmin(session);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    const status = msg === "Unauthorized" ? 401 : 403;
    return NextResponse.json({ error: msg }, { status });
  }

  const { id } = await params;

  // Prevent self-deletion
  if (session?.user?.id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  // Capture EdgeQuake doc ids before deletion so the shared corpus can be
  // de-indexed after commit (best-effort; never blocks the user deletion).
  await ensureEqDocumentIdColumn();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const docDel = await client.query(
      `DELETE FROM documents WHERE user_id = $1 RETURNING eq_document_id`,
      [id],
    );
    await client.query(`DELETE FROM categories WHERE user_id = $1`, [id]);
    await client.query(`DELETE FROM conversations WHERE user_id = $1`, [id]);
    await client.query(`DELETE FROM session WHERE "userId" = $1`, [id]);
    await client.query(`DELETE FROM account WHERE "userId" = $1`, [id]);
    const result = await client.query(`DELETE FROM "user" WHERE id = $1`, [id]);
    await client.query("COMMIT");

    // Best-effort de-index of the deleted user's docs, bounded concurrency so a
    // heavy account doesn't burst thousands of simultaneous EdgeQuake DELETEs.
    void deindexDocuments(
      docDel.rows.map((r: { eq_document_id: string | null }) => r.eq_document_id),
      "admin",
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[admin] delete user error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
