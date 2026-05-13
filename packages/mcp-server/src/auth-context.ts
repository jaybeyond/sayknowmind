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

export function rejectUserScopedEdgeQuakeTool() {
  const context = getRequestContext();

  // Admin/shared-key, stdio, and explicitly open dev modes have no per-user
  // context. Keep existing behavior there until EdgeQuake supports tenant
  // workspaces or metadata-filtered reads.
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
              "Direct EdgeQuake MCP tools are disabled for per-user API keys until EdgeQuake supports user-scoped workspaces or metadata filters. Use sayknowmind_search instead.",
          },
          null,
          2,
        ),
      },
    ],
    isError: true as const,
  };
}
