/**
 * Health tool — check EdgeQuake server health.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient, withTimeout } from "../client.js";
import { formatError } from "../errors.js";

export function registerHealthTools(server: McpServer): void {
  server.tool(
    "health",
    "Check EdgeQuake server health and component status",
    {},
    async () => {
      const TIMEOUT_MS = 5000;
      try {
        const health = await withTimeout(
          (async () => {
            const client = await getClient();
            return client.health();
          })(),
          TIMEOUT_MS,
          "EdgeQuake health check",
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(health, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
