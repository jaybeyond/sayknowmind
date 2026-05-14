/**
 * MCP server setup — creates the McpServer instance with all tools, resources, and prompts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withAudit } from "./audit.js";
import { registerPrompts } from "./prompts/rag.js";
import { registerResources } from "./resources/workspace.js";
import { registerDocumentTools } from "./tools/document.js";
import { registerGraphTools } from "./tools/graph.js";
import { registerHealthTools } from "./tools/health.js";
import { registerQueryTools } from "./tools/query.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerSayknowmindTools } from "./tools/sayknowmind.js";

/**
 * Patch server.tool() so every registration in this createServer() call
 * routes through the audit logger. The SDK's tool() has multiple
 * overloads — (name, handler), (name, desc, handler), (name, schema,
 * handler), (name, desc, schema, handler) — but the handler is always
 * the trailing function argument, so we wrap that. Registrations that
 * don't end in a function pass through unchanged.
 */
function patchToolWithAudit(server: McpServer): void {
  const original = (server.tool as unknown as (...a: unknown[]) => unknown).bind(
    server,
  );
  (server as unknown as { tool: (...a: unknown[]) => unknown }).tool = (
    ...args: unknown[]
  ) => {
    const handlerIdx = args.length - 1;
    const maybeHandler = args[handlerIdx];
    const name = args[0];
    if (typeof maybeHandler === "function" && typeof name === "string") {
      args[handlerIdx] = withAudit(
        name,
        maybeHandler as (...a: unknown[]) => unknown,
      );
    }
    return original(...args);
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "sayknowmind",
    version: "0.1.0",
  });

  patchToolWithAudit(server);

  registerHealthTools(server);
  registerWorkspaceTools(server);
  registerDocumentTools(server);
  registerQueryTools(server);
  registerGraphTools(server);
  registerSayknowmindTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}
