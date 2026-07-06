import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { isValidPriority, isValidStatus } from "@/lib/tasks/constants";
import { listWorkItems, getWorkItem, nextIdentifierNumber } from "@/lib/tasks/store";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
    { status: 401 },
  );
}

/** GET /api/tasks — list all work items in the caller's org. */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorized();
  try {
    const tasks = await listWorkItems(ctx);
    return NextResponse.json({ tasks });
  } catch (err) {
    console.error("[tasks] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** POST /api/tasks — create a work item in the caller's org. */
export async function POST(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Invalid JSON", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Title is required", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const status = isValidStatus(body.status) ? body.status : "backlog";
  const priority = isValidPriority(body.priority) ? body.priority : "no-priority";
  const description = typeof body.description === "string" ? body.description : null;
  const assigneeId = typeof body.assigneeId === "string" && body.assigneeId ? body.assigneeId : null;
  const startDate = typeof body.startDate === "string" && body.startDate ? body.startDate : null;
  const dueDate = typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null;
  const documentId = typeof body.documentId === "string" && body.documentId ? body.documentId : null;

  try {
    // If an assignee was named, it must be a member of this org — otherwise a
    // caller could assign a task to any user id. Silently drop an invalid one.
    let safeAssignee: string | null = null;
    if (assigneeId) {
      const m = await pool.query(
        `SELECT 1 FROM member WHERE "userId" = $1 AND "organizationId" = $2 LIMIT 1`,
        [assigneeId, ctx.organizationId],
      );
      if (m.rows.length > 0) safeAssignee = assigneeId;
    }

    const num = await nextIdentifierNumber(ctx.organizationId);
    const identifier = `TASK-${num}`;
    // rank: zero-padded so lexicographic DESC ≈ newest-first; later drag-reorder
    // can rewrite these with fractional keys without a schema change.
    const rank = String(num).padStart(9, "0");

    const inserted = await pool.query(
      `INSERT INTO work_items
         (user_id, organization_id, identifier, title, description, status,
          priority, assignee_id, start_date, due_date, document_id, rank, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $6 = 'completed' THEN now() ELSE NULL END)
       RETURNING id`,
      [
        ctx.userId, ctx.organizationId, identifier, title, description, status,
        priority, safeAssignee, startDate, dueDate, documentId, rank,
      ],
    );

    const task = await getWorkItem(inserted.rows[0].id, ctx);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    console.error("[tasks] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
