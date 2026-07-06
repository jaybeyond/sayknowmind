import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { isValidPriority, isValidStatus, isDoneStatus } from "@/lib/tasks/constants";
import { getWorkItem, getUserOrgs, isAssignableUser } from "@/lib/tasks/store";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
    { status: 401 },
  );
}

/** PATCH /api/tasks/:id — partial update (status, priority, assignee, etc.). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Invalid JSON", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const orgs = await getUserOrgs(ctx.userId);

  // Build the SET list from only the provided, valid fields. $1 = id,
  // $2 = the caller's org ids (the cross-org scope guard); mutable fields
  // start at $3.
  const sets: string[] = [];
  const values: unknown[] = [id, orgs.allIds];
  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (typeof body.title === "string" && body.title.trim()) push("title", body.title.trim());
  if (typeof body.description === "string") push("description", body.description);
  if (isValidPriority(body.priority)) push("priority", body.priority);
  if (typeof body.startDate === "string" || body.startDate === null) push("start_date", body.startDate || null);
  if (typeof body.dueDate === "string" || body.dueDate === null) push("due_date", body.dueDate || null);
  if (typeof body.rank === "string") push("rank", body.rank);

  if ("assigneeId" in body) {
    const assigneeId = typeof body.assigneeId === "string" && body.assigneeId ? body.assigneeId : null;
    const safe = assigneeId && (await isAssignableUser(assigneeId, orgs.allIds)) ? assigneeId : null;
    push("assignee_id", safe);
  }

  if (isValidStatus(body.status)) {
    push("status", body.status);
    // Moving into/out of the done column toggles completed_at. Using a literal
    // (not a param) is safe — the value is a validated boolean expression.
    sets.push(`completed_at = ${isDoneStatus(body.status) ? "COALESCE(completed_at, now())" : "NULL"}`);
  }

  if (sets.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "No valid fields to update", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  sets.push("updated_at = now()");

  try {
    const res = await pool.query(
      `UPDATE work_items w SET ${sets.join(", ")}
        WHERE w.id = $1 AND w.organization_id = ANY($2)
        RETURNING w.id`,
      values,
    );
    if (res.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }
    const task = await getWorkItem(id, ctx);
    return NextResponse.json({ task });
  } catch (err) {
    console.error("[tasks] PATCH error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** DELETE /api/tasks/:id — remove a work item from the caller's org. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  try {
    const orgs = await getUserOrgs(ctx.userId);
    const res = await pool.query(
      `DELETE FROM work_items w WHERE w.id = $1 AND w.organization_id = ANY($2) RETURNING w.id`,
      [id, orgs.allIds],
    );
    if (res.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tasks] DELETE error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
