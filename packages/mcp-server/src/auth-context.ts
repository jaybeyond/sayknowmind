import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  userId: string | null;
  rawToken: string;
  isAdmin: boolean;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | null {
  return requestContext.getStore() ?? null;
}

/**
 * Guard that blocks direct EdgeQuake MCP tools for per-user API keys.
 *
 * Background (Phase 6):
 *   SayKnowMind user/team data isolation is now delivered through the
 *   web-app proxy layer (`sayknowmind_*` tools). Those tools forward the
 *   caller's Bearer token to the web app, which enforces org-scoped SQL
 *   visibility rules (organization_id on documents, categories, tags, etc.)
 *   so every per-user key is automatically confined to its team's data.
 *
 *   The direct EdgeQuake tools (`query`, `graph_*`, `workspace_*`, …) bypass
 *   that web-app layer and talk to EdgeQuake directly. EdgeQuake does not yet
 *   support tenant workspaces or per-user metadata filters, so a per-user key
 *   would be able to read the shared EdgeQuake index — which could expose
 *   other users' ingested content. Until EdgeQuake-side workspace isolation is
 *   implemented, these tools remain blocked for per-user keys.
 *
 *   Admin keys (no per-user context on the request) are not blocked; they
 *   represent trusted server-to-server callers.
 */
export function rejectUserScopedEdgeQuakeTool() {
  const context = getRequestContext();

  // Admin/shared-key, stdio, and dev-open modes carry no per-user context.
  // Allow those callers through — they are trusted server-side processes.
  if (!context?.userId) return null;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: "user_isolation_unimplemented",
            status: 403,
            message:
              "Direct EdgeQuake MCP tools are disabled for per-user API keys. " +
              "Per-user and per-team data isolation is delivered through the " +
              "sayknowmind_* proxy tools (sayknowmind_search, sayknowmind_documents_list, etc.), " +
              "which enforce organization-scoped visibility via the web app. " +
              "Direct EdgeQuake access will be re-enabled once EdgeQuake supports " +
              "tenant workspaces or metadata-filtered reads.",
          },
          null,
          2,
        ),
      },
    ],
    isError: true as const,
  };
}

/**
 * Same rationale as rejectUserScopedEdgeQuakeTool() but shaped for MCP
 * resource read callbacks, which return `{ contents: [...] }` instead
 * of `{ content: [...] }`.
 *
 * See the comment on rejectUserScopedEdgeQuakeTool() for the full
 * explanation of why direct EdgeQuake access is blocked for per-user keys
 * and how isolation is achieved through the sayknowmind_* proxy tools.
 */
export function rejectUserScopedEdgeQuakeResource(uri: URL) {
  const context = getRequestContext();
  if (!context?.userId) return null;

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error: "user_isolation_unimplemented",
            status: 403,
            message:
              "Workspace resources are disabled for per-user API keys. " +
              "Use sayknowmind_documents_list or sayknowmind_search instead — " +
              "those tools proxy through the web app and enforce org-scoped visibility.",
          },
          null,
          2,
        ),
      },
    ],
  };
}
