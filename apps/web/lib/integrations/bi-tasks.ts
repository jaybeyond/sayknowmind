import { createHash, createHmac } from "node:crypto";
import { pool } from "@/lib/db";
import type { OrgContext } from "@/lib/org-context";
import type {
  Task,
  TaskPriorityId,
  TaskProject,
  TaskStatusId,
} from "@/lib/tasks/constants";

type JsonMap = Record<string, string>;

interface BiConfig {
  enabled: boolean;
  baseUrl: string;
  serviceToken: string;
  serviceLoginId: string;
  servicePassword: string;
  integrationSecret: string;
  defaultAssigneeId: string;
  defaultDueDays: number;
  legacyOrgProjectMap: JsonMap;
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
  color?: string | null;
  status?: string | null;
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

interface BiActor {
  memberId?: string;
  email?: string;
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

interface SignatureInput {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  actorMemberId?: string;
  actorEmail?: string;
  body?: string;
}

type UpdateBiTaskInput = Record<string, unknown>;
type BiTaskScope = "all" | "personal" | "team";

let cachedToken: string | null = null;

export class BiTaskBridgeError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BiTaskBridgeError";
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
  return Array.from(
    new Set(
      (raw ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function getConfig(): BiConfig {
  return {
    enabled: process.env.BI_TASKS_ENABLED === "true",
    baseUrl: (process.env.BI_API_BASE_URL ?? "").replace(/\/+$/, ""),
    serviceToken: process.env.BI_SERVICE_TOKEN ?? "",
    serviceLoginId: process.env.BI_SERVICE_LOGIN_ID ?? process.env.BI_SERVICE_EMAIL ?? "",
    servicePassword: process.env.BI_SERVICE_PASSWORD ?? "",
    integrationSecret: process.env.BI_INTEGRATION_SECRET ?? "",
    defaultAssigneeId: process.env.BI_DEFAULT_ASSIGNEE_ID ?? "",
    defaultDueDays: Number(process.env.BI_DEFAULT_DUE_DAYS ?? 7) || 7,
    legacyOrgProjectMap: parseJsonMap(process.env.BI_ORG_PROJECT_MAP),
    userMap: parseJsonMap(process.env.BI_USER_MAP),
    enabledOrganizationIds: parseIdList(process.env.BI_TASKS_ORGANIZATION_IDS),
  };
}

export function isBiTasksEnabled(ctx: OrgContext): boolean {
  const config = getConfig();
  const organizationEnabled = config.enabledOrganizationIds.includes(ctx.organizationId)
    || Boolean(config.legacyOrgProjectMap[ctx.organizationId]);
  return config.enabled && organizationEnabled;
}

function assertConfigured(config: BiConfig) {
  if (!config.enabled) throw new BiTaskBridgeError("BI task integration is disabled", 503);
  if (!config.baseUrl) throw new BiTaskBridgeError("BI API is not configured", 503);
  if (config.integrationSecret.trim().length < 32) {
    throw new BiTaskBridgeError("BI delegated access is not configured", 503);
  }
  if (!config.serviceToken && (!config.serviceLoginId || !config.servicePassword)) {
    throw new BiTaskBridgeError("BI service account is not configured", 503);
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
  if (!res.ok) throw new BiTaskBridgeError("BI service account login failed", 502);
  const data = await res.json() as { token?: string };
  if (!data.token) throw new BiTaskBridgeError("BI service account login returned no token", 502);
  cachedToken = data.token;
  return data.token;
}

async function getMindUser(userId: string): Promise<MindUser | null> {
  const res = await pool.query(
    `SELECT id, name, email, image FROM "user" WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return res.rows[0] ? res.rows[0] as MindUser : null;
}

async function resolveBiActor(ctx: OrgContext, config: BiConfig): Promise<BiActor> {
  const mappedId = config.userMap[ctx.userId]?.trim();
  if (mappedId) return { memberId: mappedId };

  const user = await getMindUser(ctx.userId);
  const email = user?.email?.trim().toLowerCase();
  if (email) return { email };

  throw new BiTaskBridgeError("Current Mind account is not linked to a BI account", 403);
}

function bodyDigest(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function buildBiIntegrationSignature(input: SignatureInput): string {
  const canonical = [
    input.timestamp,
    input.method.toUpperCase(),
    input.path,
    input.actorMemberId?.trim() ?? "",
    input.actorEmail?.trim().toLowerCase() ?? "",
    bodyDigest(input.body ?? ""),
  ].join("\n");
  return createHmac("sha256", input.secret).update(canonical).digest("hex");
}

function bridgeStatus(status: number): number {
  if ([400, 403, 404, 409].includes(status)) return status;
  return 502;
}

function bridgeMessage(status: number): string {
  if (status === 400) return "BI rejected the task data";
  if (status === 403) return "No permission for this BI project";
  if (status === 404) return "BI project or task not found";
  if (status === 409) return "BI task data conflict";
  return "BI task service is unavailable";
}

async function biRequest<T>(
  ctx: OrgContext,
  path: string,
  init: RequestInit = {},
  forceRefresh = false,
): Promise<T> {
  const config = getConfig();
  assertConfigured(config);
  const token = await getBiToken(config, forceRefresh);
  const actor = await resolveBiActor(ctx, config);
  const url = new URL(`${config.baseUrl}${path}`);
  const body = typeof init.body === "string" ? init.body : "";
  if (init.body && typeof init.body !== "string") {
    throw new BiTaskBridgeError("BI bridge only accepts JSON request bodies", 500);
  }

  const timestamp = String(Date.now());
  const signature = buildBiIntegrationSignature({
    secret: config.integrationSecret,
    timestamp,
    method: init.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    actorMemberId: actor.memberId,
    actorEmail: actor.email,
    body,
  });
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Integration-Timestamp", timestamp);
  headers.set("X-Integration-Signature", signature);
  if (actor.memberId) headers.set("X-Integration-Actor-Id", actor.memberId);
  if (actor.email) headers.set("X-Integration-Actor-Email", actor.email);
  if (body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !forceRefresh && !config.serviceToken) {
    cachedToken = null;
    return biRequest<T>(ctx, path, init, true);
  }
  if (res.headers.get("x-sayknowmind-integration") !== "delegated") {
    throw new BiTaskBridgeError("BI delegated access is not active", 503);
  }
  if (!res.ok) {
    const status = bridgeStatus(res.status);
    throw new BiTaskBridgeError(bridgeMessage(status), status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function biListAll<T>(ctx: OrgContext, path: string, params: URLSearchParams): Promise<T[]> {
  const pageSize = 200;
  const firstParams = new URLSearchParams(params);
  firstParams.set("page", "1");
  firstParams.set("pageSize", String(pageSize));

  const first = await biRequest<Paginated<T> | T[]>(ctx, `${path}?${firstParams.toString()}`);
  const rows = [...rowsOf(first)];
  const totalPages = toPageCount(first);

  for (let page = 2; page <= totalPages; page += 1) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", String(page));
    nextParams.set("pageSize", String(pageSize));
    const next = await biRequest<Paginated<T> | T[]>(ctx, `${path}?${nextParams.toString()}`);
    rows.push(...rowsOf(next));
  }
  return rows;
}

function requireProjectId(projectId: string | null | undefined): string {
  const value = projectId?.trim();
  if (!value) throw new BiTaskBridgeError("A BI project must be selected", 400);
  return value;
}

async function listBiProjectMembers(ctx: OrgContext, projectId: string): Promise<BiMember[]> {
  const members = await biRequest<BiMember[]>(
    ctx,
    `/projects/${encodeURIComponent(projectId)}/members`,
  );
  const byId = new Map<string, BiMember>();
  for (const member of members) {
    if (member?.id) byId.set(member.id, member);
  }
  return [...byId.values()];
}

async function findBiAssigneeId(
  ctx: OrgContext,
  projectId: string,
  mindUserId: string | null | undefined,
): Promise<string | null> {
  const config = getConfig();
  const members = await listBiProjectMembers(ctx, projectId);
  const mappedId = mindUserId ? config.userMap[mindUserId] : undefined;
  if (mappedId && members.some((member) => member.id === mappedId)) return mappedId;
  if (mindUserId && members.some((member) => member.id === mindUserId)) return mindUserId;

  if (mindUserId) {
    const user = await getMindUser(mindUserId);
    const email = user?.email?.toLowerCase();
    const match = email ? members.find((member) => member.email?.toLowerCase() === email) : undefined;
    if (match?.id) return match.id;
  }

  return null;
}

async function resolveBiAssigneeId(
  ctx: OrgContext,
  projectId: string,
  mindUserId: string | null | undefined,
): Promise<string> {
  const config = getConfig();
  const mapped = await findBiAssigneeId(ctx, projectId, mindUserId);
  if (mapped) return mapped;
  const members = await listBiProjectMembers(ctx, projectId);
  if (config.defaultAssigneeId && members.some((member) => member.id === config.defaultAssigneeId)) {
    return config.defaultAssigneeId;
  }
  throw new BiTaskBridgeError("No BI assignee mapping was found for this project", 400);
}

function defaultDueDate(): string {
  const config = getConfig();
  const date = new Date();
  date.setDate(date.getDate() + config.defaultDueDays);
  date.setHours(18, 0, 0, 0);
  return date.toISOString();
}

function mindStatusToBi(status: unknown): BiStatus {
  if (status === "paused") {
    throw new BiTaskBridgeError("BI tasks do not support the paused status", 400);
  }
  const map: Record<string, BiStatus> = {
    backlog: "planning",
    todo: "starting",
    "in-progress": "executing",
    "technical-review": "wrapping_up",
    completed: "delivered",
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
  if (priority === "no-priority") {
    throw new BiTaskBridgeError("BI tasks require a priority", 400);
  }
  if (priority === "urgent") return { priority: "urgent", priorityLevel: "P0" };
  if (priority === "high") return { priority: "high", priorityLevel: "P1" };
  if (priority === "low") return { priority: "low", priorityLevel: "P5" };
  return { priority: "medium", priorityLevel: "P3" };
}

function biPriorityToMind(task: BiTask): TaskPriorityId {
  if (task.priorityLevel === "P0") return "urgent";
  if (task.priorityLevel === "P1" || task.priorityLevel === "P2") return "high";
  if (task.priorityLevel === "P5") return "low";
  return task.priority ?? "no-priority";
}

function mapProject(project: BiProject | null | undefined, projectId: string): TaskProject {
  return {
    id: project?.id ?? projectId,
    name: project?.name?.trim() || projectId,
    color: project?.color ?? null,
    status: project?.status ?? null,
  };
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
    projectId: task.projectId,
    project: mapProject(task.project, task.projectId),
    rank: String(new Date(task.createdAt).getTime()),
    startDate: null,
    dueDate: task.dueDate ?? null,
    documentId: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.status === "delivered" ? task.updatedAt : null,
  };
}

function mapCreateBody(
  input: CreateBiTaskInput,
  projectId: string,
  assigneeId: string,
): Record<string, unknown> {
  return {
    title: input.title,
    description: input.description ?? "",
    status: mindStatusToBi(input.status),
    ...mindPriorityToBi(input.priority),
    projectId,
    assigneeId,
    dueDate: input.dueDate || defaultDueDate(),
    tags: [],
    progress: 0,
  };
}

async function mapUpdateBody(
  ctx: OrgContext,
  projectId: string,
  input: UpdateBiTaskInput,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (typeof input.title === "string" && input.title.trim()) body.title = input.title.trim();
  if (typeof input.description === "string") body.description = input.description;
  if (typeof input.status === "string") body.status = mindStatusToBi(input.status);
  if (typeof input.priority === "string") Object.assign(body, mindPriorityToBi(input.priority));
  if (typeof input.dueDate === "string" && input.dueDate) body.dueDate = input.dueDate;
  if ("assigneeId" in input) {
    const assigneeId = typeof input.assigneeId === "string" && input.assigneeId ? input.assigneeId : null;
    body.assigneeId = await resolveBiAssigneeId(ctx, projectId, assigneeId);
  }
  return body;
}

async function getBiTask(ctx: OrgContext, id: string): Promise<BiTask> {
  try {
    return await biRequest<BiTask>(ctx, `/tasks/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof BiTaskBridgeError && error.status === 404) {
      throw new BiTaskBridgeError("BI task not found", 404);
    }
    throw error;
  }
}

export async function listBiTaskProjects(ctx: OrgContext): Promise<TaskProject[]> {
  const rows = await biListAll<BiProject>(ctx, "/projects", new URLSearchParams());
  return rows.map((project) => mapProject(project, project.id));
}

export async function listBiTasks(
  ctx: OrgContext,
  scope: BiTaskScope = "all",
  projectId?: string | null,
): Promise<Task[]> {
  const params = new URLSearchParams();
  if (projectId?.trim()) params.set("projectId", projectId.trim());
  if (scope === "personal") params.set("assigneeId", "me");
  const rows = await biListAll<BiTask>(ctx, "/tasks", params);
  return rows.map(mapBiTask);
}

export async function listBiTaskMembers(
  ctx: OrgContext,
  projectId: string | null | undefined,
): Promise<Array<{ id: string; name: string | null; email: string | null; image: string | null }>> {
  const selectedProjectId = requireProjectId(projectId);
  return (await listBiProjectMembers(ctx, selectedProjectId)).map((member) => ({
    id: member.id,
    name: member.name ?? null,
    email: member.email ?? null,
    image: member.avatar ?? null,
  }));
}

export async function createBiTask(ctx: OrgContext, input: CreateBiTaskInput): Promise<Task> {
  const projectId = requireProjectId(input.projectId);
  mindStatusToBi(input.status);
  mindPriorityToBi(input.priority);
  const assigneeId = await resolveBiAssigneeId(ctx, projectId, input.assigneeId || ctx.userId);
  const task = await biRequest<BiTask>(ctx, "/tasks", {
    method: "POST",
    body: JSON.stringify(mapCreateBody(input, projectId, assigneeId)),
  });
  return mapBiTask(task);
}

export async function updateBiTask(ctx: OrgContext, id: string, input: UpdateBiTaskInput): Promise<Task> {
  const existing = await getBiTask(ctx, id);
  const body = await mapUpdateBody(ctx, existing.projectId, input);
  if (Object.keys(body).length === 0) throw new BiTaskBridgeError("No valid BI task fields to update", 400);
  const task = await biRequest<BiTask>(ctx, `/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return mapBiTask(task);
}

export async function deleteBiTask(ctx: OrgContext, id: string): Promise<void> {
  await getBiTask(ctx, id);
  await biRequest<{ success: boolean }>(ctx, `/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}
