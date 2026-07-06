/**
 * Server-side data access for work items (the "Tasks" feature). Keeps the SQL
 * and row→DTO mapping in one place so the route handlers stay thin.
 */
import { pool } from "@/lib/db";
import type { OrgContext } from "@/lib/org-context";
import { orgScopeClause } from "@/lib/visibility";
import type { Task, TaskLabel } from "./constants";

interface WorkItemRow {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  labels: TaskLabel[] | null;
  rank: string | null;
  start_date: string | null;
  due_date: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  assignee_image: string | null;
}

export function mapWorkItem(r: WorkItemRow): Task {
  return {
    id: r.id,
    identifier: r.identifier,
    title: r.title,
    description: r.description,
    status: r.status as Task["status"],
    priority: r.priority as Task["priority"],
    assignee: r.assignee_id
      ? { id: r.assignee_id, name: r.assignee_name, email: r.assignee_email, image: r.assignee_image }
      : null,
    labels: Array.isArray(r.labels) ? r.labels : [],
    rank: r.rank,
    startDate: r.start_date,
    dueDate: r.due_date,
    documentId: r.document_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

const SELECT_COLUMNS = `
  w.id, w.identifier, w.title, w.description, w.status, w.priority,
  w.labels, w.rank, w.start_date, w.due_date, w.document_id, w.created_at,
  w.updated_at, w.completed_at, w.assignee_id,
  u.name AS assignee_name, u.email AS assignee_email, u.image AS assignee_image
`;

/** List every work item visible to the caller's org, newest-ranked first. */
export async function listWorkItems(ctx: OrgContext): Promise<Task[]> {
  const res = await pool.query(
    `SELECT ${SELECT_COLUMNS}
       FROM work_items w
       LEFT JOIN "user" u ON u.id = w.assignee_id
      WHERE ${orgScopeClause("w", 1)}
      ORDER BY w.rank DESC NULLS LAST, w.created_at DESC`,
    [ctx.organizationId],
  );
  return res.rows.map(mapWorkItem);
}

/** Fetch one work item by id, org-scoped. */
export async function getWorkItem(id: string, ctx: OrgContext): Promise<Task | null> {
  const res = await pool.query(
    `SELECT ${SELECT_COLUMNS}
       FROM work_items w
       LEFT JOIN "user" u ON u.id = w.assignee_id
      WHERE w.id = $1 AND ${orgScopeClause("w", 2)}`,
    [id, ctx.organizationId],
  );
  return res.rows[0] ? mapWorkItem(res.rows[0]) : null;
}

/**
 * Reserve the next per-org identifier number atomically. Upserts the counter
 * row and returns the incremented value in one round trip, so concurrent
 * creates can't collide on TASK-NNN.
 */
export async function nextIdentifierNumber(organizationId: string): Promise<number> {
  const key = organizationId || "_personal";
  const res = await pool.query(
    `INSERT INTO work_item_counters (organization_id, last_number)
     VALUES ($1, 1)
     ON CONFLICT (organization_id)
     DO UPDATE SET last_number = work_item_counters.last_number + 1
     RETURNING last_number`,
    [key],
  );
  return res.rows[0].last_number as number;
}
