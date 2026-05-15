/**
 * Health tool — check EdgeQuake server health.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { formatError } from "../errors.js";

export function registerHealthTools(server: McpServer): void {
  server.tool(
    "health",
    "Check EdgeQuake server health and component status",
    {},
    async () => {
      const TIMEOUT_MS = 5000;
      try {
        const health = await Promise.race([
          (async () => {
            const client = await getClient();
            return client.health();
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `EdgeQuake health check timed out after ${TIMEOUT_MS}ms — server unreachable at the configured EDGEQUAKE_URL`,
                  ),
                ),
              TIMEOUT_MS,
            ),
          ),
        ]);
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
