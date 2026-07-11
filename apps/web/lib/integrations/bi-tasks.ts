import { pool } from "@/lib/db";
import type { OrgContext } from "@/lib/org-context";
import type { Task, TaskPriorityId, TaskStatusId } from "@/lib/tasks/constants";

type JsonMap = Record<string, string>;

interface BiConfig {
  enabled: boolean;
  baseUrl: string;
  serviceToken: string;
  serviceLoginId: string;
  servicePassword: string;
  defaultProjectId: string;
  defaultAssigneeId: string;
  defaultDueDays: number;
  orgProjectMap: JsonMap;
  userMap: JsonMap;
  enabledOrganizationIds: string[];
}

interface BiMember {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
}

interface BiProject {
  id: string;
  name?: string | null;
}

interface BiComment {
  id: string;
  authorId?: string;
  content?: string;
  createdAt?: string;
}

interface BiSubtask {
  id: string;
  title: string;
  done: boolean;
}

interface BiTask {
  id: string;
  title: string;
  description?: string | null;
  status: BiStatus;
  priority: BiPriority;
  priorityLevel?: BiPriorityLevel | null;
  projectId: string;
  assigneeId: string;
  dueDate: string;
  tags?: string[];
  progress?: number;
  assignee?: BiMember | null;
  project?: BiProject | null;
  comments?: BiComment[];
  subtasks?: BiSubtask[];
  createdAt: string;
  updatedAt: string;
}

interface Paginated<T> {
  data: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

type BiStatus = "planning" | "starting" | "executing" | "sprinting" | "wrapping_up" | "delivered";
type BiPriority = "low" | "medium" | "high" | "urgent";
type BiPriorityLevel = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";

interface MindUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface CreateBiTaskInput {
  title: string;
  status?: string;
  priority?: string;
  description?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  projectId?: string | null;
}

type UpdateBiTaskInput = Record<string, unknown>;
type BiTaskScope = "all" | "personal" | "team";

let cachedToken: string | null = null;
const cachedProjectMembers = new Map<string, { at: number; members: BiMember[] }>();

export class BiTaskBridgeError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BiTaskBridgeError";
  }
}

class BiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BiRequestError";
  }
}

function parseJsonMap(raw: string | undefined): JsonMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => key.trim().length > 0 && typeof value === "string" && value.trim().length > 0,
      ),
    ) as JsonMap;
  } catch {
    return {};
  }
}

function parseIdList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getConfig(): BiConfig {
  const enabled = process.env.BI_TASKS_ENABLED === "true";
  const baseUrl = (process.env.BI_API_BASE_URL ?? "").replace(/\/+$/, "");
  return {
    enabled,
    baseUrl,
    serviceToken: process.env.BI_SERVICE_TOKEN ?? "",
    serviceLoginId: process.env.BI_SERVICE_LOGIN_ID ?? process.env.BI_SERVICE_EMAIL ?? "",
    servicePassword: process.env.BI_SERVICE_PASSWORD ?? "",
    defaultProjectId: process.env.BI_DEFAULT_PROJECT_ID ?? "",
    defaultAssigneeId: process.env.BI_DEFAULT_ASSIGNEE_ID ?? "",
    defaultDueDays: Number(process.env.BI_DEFAULT_DUE_DAYS ?? 7) || 7,
    orgProjectMap: parseJsonMap(process.env.BI_ORG_PROJECT_MAP),
    userMap: parseJsonMap(process.env.BI_USER_MAP),
    enabledOrganizationIds: parseIdList(process.env.BI_TASKS_ORGANIZATION_IDS),
  };
}

export function isBiTasksEnabled(ctx: OrgContext): boolean {
  const config = getConfig();
  return config.enabled && Boolean(resolveBiProjectId(ctx, config));
}

function assertConfigured(config: BiConfig) {
  if (!config.enabled) throw new Error("BI task integration is disabled");
  if (!config.baseUrl) throw new Error("BI_API_BASE_URL is required when BI_TASKS_ENABLED=true");
  if (!config.serviceToken && (!config.serviceLoginId || !config.servicePassword)) {
    throw new Error("BI_SERVICE_TOKEN or BI_SERVICE_LOGIN_ID/BI_SERVICE_PASSWORD is required");
  }
}

function toPageCount(res: Paginated<unknown> | unknown[]): number {
  if (Array.isArray(res)) return 1;
  const explicit = Number(res.totalPages);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const total = Number(res.total);
  const pageSize = Number(res.pageSize);
  if (Number.isFinite(total) && Number.isFinite(pageSize) && pageSize > 0) {
    return Math.max(1, Math.ceil(total / pageSize));
  }
  return 1;
}

function rowsOf<T>(res: Paginated<T> | T[]): T[] {
  return Array.isArray(res) ? res : Array.isArray(res.data) ? res.data : [];
}

async function getBiToken(config: BiConfig, forceRefresh = false): Promise<string> {
  if (config.serviceToken) return config.serviceToken;
  if (cachedToken && !forceRefresh) return cachedToken;

  const res = await fetch(`${config.baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.serviceLoginId, password: config.servicePassword }),
  });
  if (!res.ok) throw new Error(`BI login failed: ${res.status}`);
  const data = await res.json() as { token?: string };
  if (!data.token) throw new Error("BI login did not return a token");
  cachedToken = data.token;
  return data.token;
}

async function biRequest<T>(
  path: string,
  init: RequestInit = {},
  forceRefresh = false,
): Promise<T> {
  const config = getConfig();
  assertConfigured(config);
  const token = await getBiToken(config, forceRefresh);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.baseUrl}${path}`, { ...init, headers });
  if (res.status === 401 && !forceRefresh && !config.serviceToken) {
    cachedToken = null;
    return biRequest<T>(path, init, true);
  }
  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new BiRequestError(`BI request ${path} failed: ${res.status} ${message.slice(0, 200)}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function biListAll<T>(path: string, params: URLSearchParams): Promise<T[]> {
  const pageSize = 200;
  const firstParams = new URLSearchParams(params);
  firstParams.set("page", "1");
  firstParams.set("pageSize", String(pageSize));

  const first = await biRequest<Paginated<T> | T[]>(`${path}?${firstParams.toString()}`);
  const rows = [...rowsOf(first)];
  const totalPages = toPageCount(first);

  for (let page = 2; page <= totalPages; page += 1) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", String(page));
    nextParams.set("pageSize", String(pageSize));
    const next = await biRequest<Paginated<T> | T[]>(`${path}?${nextParams.toString()}`);
    rows.push(...rowsOf(next));
  }
  return rows;
}

async function getMindUser(userId: string): Promise<MindUser | null> {
  const res = await pool.query(
    `SELECT id, name, email, image FROM "user" WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return res.rows[0] ? res.rows[0] as MindUser : null;
}

function resolveBiProjectId(ctx: OrgContext, config = getConfig()): string {
  const mapped = config.orgProjectMap[ctx.organizationId]?.trim();
  if (mapped) return mapped;
  if (config.enabledOrganizationIds.includes(ctx.organizationId)) return config.defaultProjectId.trim();
  return "";
}

function requireBiProjectId(ctx: OrgContext): string {
  const projectId = resolveBiProjectId(ctx);
  if (!projectId) {
    throw new BiTaskBridgeError("BI tasks are not configured for this organization", 404);
  }
  return projectId;
}

async function listBiProjectMembers(ctx: OrgContext): Promise<BiMember[]> {
  const projectId = requireBiProjectId(ctx);
  const now = Date.now();
  const cached = cachedProjectMembers.get(projectId);
  if (cached && now - cached.at < 60_000) return cached.members;

  const projectMembers = await biRequest<BiMember[]>(`/projects/${encodeURIComponent(projectId)}/members`);
  const byId = new Map<string, BiMember>();
  for (const member of projectMembers) {
    if (member?.id) byId.set(member.id, member);
  }
  const members = [...byId.values()];
  cachedProjectMembers.set(projectId, { at: now, members });
  return members;
}

async function findBiAssigneeId(ctx: OrgContext, mindUserId: string | null | undefined): Promise<string | null> {
  const config = getConfig();
  const members = await listBiProjectMembers(ctx);
  const mappedId = mindUserId ? config.userMap[mindUserId] : undefined;
  if (mappedId && members.some((m) => m.id === mappedId)) return mappedId;
  if (mindUserId && members.some((m) => m.id === mindUserId)) return mindUserId;

  if (mindUserId) {
    const user = await getMindUser(mindUserId);
    const email = user?.email?.toLowerCase();
    if (email) {
      const match = members.find((m) => m.email?.toLowerCase() === email);
      if (match?.id) return match.id;
    }
  }

  return null;
}

async function resolveBiAssigneeId(ctx: OrgContext, mindUserId: string | null | undefined): Promise<string> {
  const config = getConfig();
  const mapped = await findBiAssigneeId(ctx, mindUserId);
  if (mapped) return mapped;
  const members = await listBiProjectMembers(ctx);

  if (config.defaultAssigneeId && members.some((m) => m.id === config.defaultAssigneeId)) {
    return config.defaultAssigneeId;
  }
  throw new Error("No BI assignee mapping found; configure BI_USER_MAP or BI_DEFAULT_ASSIGNEE_ID");
}

function defaultDueDate(): string {
  const config = getConfig();
  const d = new Date();
  d.setDate(d.getDate() + config.defaultDueDays);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

function mindStatusToBi(status: unknown): BiStatus {
  const map: Record<string, BiStatus> = {
    backlog: "planning",
    todo: "starting",
    "in-progress": "executing",
    "technical-review": "wrapping_up",
    completed: "delivered",
    paused: "planning",
  };
  return typeof status === "string" && map[status] ? map[status] : "planning";
}

function biStatusToMind(status: BiStatus): TaskStatusId {
  const map: Record<BiStatus, TaskStatusId> = {
    planning: "backlog",
    starting: "todo",
    executing: "in-progress",
    sprinting: "in-progress",
    wrapping_up: "technical-review",
    delivered: "completed",
  };
  return map[status] ?? "backlog";
}

function mindPriorityToBi(priority: unknown): { priority: BiPriority; priorityLevel: BiPriorityLevel } {
  if (priority === "urgent") return { priority: "urgent", priorityLevel: "P0" };
  if (priority === "high") return { priority: "high", priorityLevel: "P1" };
  if (priority === "low") return { priority: "low", priorityLevel: "P5" };
  return { priority: "medium", priorityLevel: "P3" };
}

function biPriorityToMind(task: BiTask): TaskPriorityId {
  const level = task.priorityLevel;
  if (level === "P0") return "urgent";
  if (level === "P1" || level === "P2") return "high";
  if (level === "P5") return "low";
  if (task.priority === "urgent" || task.priority === "high" || task.priority === "medium" || task.priority === "low") {
    return task.priority;
  }
  return "no-priority";
}

function mapBiTask(task: BiTask): Task {
  const assignee = task.assignee ?? null;
  return {
    id: task.id,
    identifier: `BI-${task.id.slice(0, 8)}`,
    title: task.title,
    description: task.description ?? null,
    status: biStatusToMind(task.status),
    priority: biPriorityToMind(task),
    assignee: assignee
      ? { id: assignee.id, name: assignee.name ?? null, email: assignee.email ?? null, image: assignee.avatar ?? null }
      : null,
    labels: (task.tags ?? []).map((tag) => ({ id: tag, name: tag, color: "#64748b" })),
    rank: String(new Date(task.createdAt).getTime()),
    startDate: null,
    dueDate: task.dueDate ?? null,
    documentId: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.status === "delivered" ? task.updatedAt : null,
  };
}

function mapCreateBody(ctx: OrgContext, input: CreateBiTaskInput, assigneeId: string): Record<string, unknown> {
  const priority = mindPriorityToBi(input.priority);
  const projectId = requireBiProjectId(ctx);
  return {
    title: input.title,
    description: input.description ?? "",
    status: mindStatusToBi(input.status),
    ...priority,
    projectId,
    assigneeId,
    dueDate: input.dueDate || defaultDueDate(),
    tags: [],
    progress: 0,
  };
}

async function mapUpdateBody(ctx: OrgContext, input: UpdateBiTaskInput): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (typeof input.title === "string" && input.title.trim()) body.title = input.title.trim();
  if (typeof input.description === "string") body.description = input.description;
  if (typeof input.status === "string") body.status = mindStatusToBi(input.status);
  if (typeof input.priority === "string") Object.assign(body, mindPriorityToBi(input.priority));
  if (typeof input.dueDate === "string" && input.dueDate) body.dueDate = input.dueDate;
  if ("assigneeId" in input) {
    const assigneeId = typeof input.assigneeId === "string" && input.assigneeId ? input.assigneeId : null;
    body.assigneeId = await resolveBiAssigneeId(ctx, assigneeId);
  }
  return body;
}

async function getBiTaskInProject(ctx: OrgContext, id: string): Promise<BiTask> {
  const projectId = requireBiProjectId(ctx);
  let task: BiTask;
  try {
    task = await biRequest<BiTask>(`/tasks/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof BiRequestError && error.status === 404) {
      throw new BiTaskBridgeError("BI task not found", 404);
    }
    throw error;
  }
  if (task.projectId !== projectId) throw new BiTaskBridgeError("BI task not found", 404);
  return task;
}

export async function listBiTasks(ctx: OrgContext, scope: BiTaskScope = "all"): Promise<Task[]> {
  const projectId = requireBiProjectId(ctx);
  const params = new URLSearchParams({ projectId });
  if (scope === "personal") {
    const assigneeId = await findBiAssigneeId(ctx, ctx.userId);
    if (!assigneeId) return [];
    params.set("assigneeId", assigneeId);
  }
  const rows = await biListAll<BiTask>("/tasks", params);
  return rows.map(mapBiTask);
}

export async function listBiTaskMembers(ctx: OrgContext): Promise<Array<{ id: string; name: string | null; email: string | null; image: string | null }>> {
  return (await listBiProjectMembers(ctx)).map((m) => ({
    id: m.id,
    name: m.name ?? null,
    email: m.email ?? null,
    image: m.avatar ?? null,
  }));
}

export async function createBiTask(ctx: OrgContext, input: CreateBiTaskInput): Promise<Task> {
  const assigneeId = await resolveBiAssigneeId(ctx, input.assigneeId || ctx.userId);
  const body = mapCreateBody(ctx, input, assigneeId);
  const task = await biRequest<BiTask>("/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return mapBiTask(task);
}

export async function updateBiTask(ctx: OrgContext, id: string, input: UpdateBiTaskInput): Promise<Task> {
  await getBiTaskInProject(ctx, id);
  const body = await mapUpdateBody(ctx, input);
  if (Object.keys(body).length === 0) throw new Error("No valid BI task fields to update");
  const task = await biRequest<BiTask>(`/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (task.projectId !== requireBiProjectId(ctx)) throw new BiTaskBridgeError("BI task not found", 404);
  return mapBiTask(task);
}

export async function deleteBiTask(ctx: OrgContext, id: string): Promise<void> {
  await getBiTaskInProject(ctx, id);
  await biRequest<{ success: boolean }>(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}
