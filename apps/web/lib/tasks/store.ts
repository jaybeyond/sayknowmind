/**
 * Server-side data access for work items (the "Tasks" feature). Keeps the SQL
 * and row→DTO mapping in one place so the route handlers stay thin.
 */
import { pool } from "@/lib/db";
import type { OrgContext } from "@/lib/org-context";
import type { Task, TaskLabel } from "./constants";

/** Which slice of the caller's work items to return. */
export type TaskScope = "all" | "personal" | "team";

interface UserOrgs {
  /** The caller's personal org id (slug personal-<userId>), or null. */
  personalId: string | null;
  /** Team org ids (every membership that isn't the personal org). */
  teamIds: string[];
  /** All org ids the caller belongs to. */
  allIds: string[];
}

/** Every org the caller belongs to, split into personal vs team. */
export async function getUserOrgs(userId: string): Promise<UserOrgs> {
  const res = await pool.query(
    `SELECT o.id, (o.slug = $2) AS is_personal
       FROM member m
       JOIN organization o ON o.id = m."organizationId"
      WHERE m."userId" = $1`,
    [userId, `personal-${userId}`],
  );
  let personalId: string | null = null;
  const teamIds: string[] = [];
  const allIds: string[] = [];
  for (const r of res.rows as Array<{ id: string; is_personal: boolean }>) {
    allIds.push(r.id);
    if (r.is_personal) personalId = r.id;
    else teamIds.push(r.id);
  }
  return { personalId, teamIds, allIds };
}

/** Org ids that a given scope resolves to, for the caller's memberships. */
function orgIdsForScope(orgs: UserOrgs, scope: TaskScope): string[] {
  if (scope === "personal") return orgs.personalId ? [orgs.personalId] : [];
  if (scope === "team") return orgs.teamIds;
  return orgs.allIds;
}

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

// A work item is visible to the caller when it belongs to one of their orgs
// AND is either shared, created by them, or assigned to them — so one member's
// private task never leaks to the rest of the org. $orgs is a text[] of org ids,
// $me is the caller's user id.
const VISIBILITY = (orgsParam: number, meParam: number) =>
  `w.organization_id = ANY($${orgsParam})
   AND (w.privacy_level <> 'private' OR w.user_id = $${meParam} OR w.assignee_id = $${meParam})`;

/**
 * List work items across the caller's orgs, filtered by scope (personal / team
 * / all), newest-ranked first. Spans every membership — not just the active
 * org — so the Tasks page can show personal and team work together.
 */
export async function listWorkItems(ctx: OrgContext, scope: TaskScope = "all"): Promise<Task[]> {
  const orgs = await getUserOrgs(ctx.userId);
  const orgIds = orgIdsForScope(orgs, scope);
  if (orgIds.length === 0) return [];
  const res = await pool.query(
    `SELECT ${SELECT_COLUMNS}
       FROM work_items w
       LEFT JOIN "user" u ON u.id = w.assignee_id
      WHERE ${VISIBILITY(1, 2)}
      ORDER BY w.rank DESC NULLS LAST, w.created_at DESC`,
    [orgIds, ctx.userId],
  );
  return res.rows.map(mapWorkItem);
}

/** Fetch one work item by id, visible to the caller across any of their orgs. */
export async function getWorkItem(id: string, ctx: OrgContext): Promise<Task | null> {
  const orgs = await getUserOrgs(ctx.userId);
  if (orgs.allIds.length === 0) return null;
  const res = await pool.query(
    `SELECT ${SELECT_COLUMNS}
       FROM work_items w
       LEFT JOIN "user" u ON u.id = w.assignee_id
      WHERE w.id = $1 AND ${VISIBILITY(2, 3)}`,
    [id, orgs.allIds, ctx.userId],
  );
  return res.rows[0] ? mapWorkItem(res.rows[0]) : null;
}

/**
 * A candidate assignee is allowed if they share at least one org with the
 * caller — prevents assigning a task to a total stranger while still working
 * across the caller's personal + team orgs.
 */
export async function isAssignableUser(candidateId: string, callerOrgIds: string[]): Promise<boolean> {
  if (callerOrgIds.length === 0) return false;
  const res = await pool.query(
    `SELECT 1 FROM member WHERE "userId" = $1 AND "organizationId" = ANY($2) LIMIT 1`,
    [candidateId, callerOrgIds],
  );
  return res.rows.length > 0;
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
