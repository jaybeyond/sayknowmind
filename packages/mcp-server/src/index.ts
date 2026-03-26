/**
 * EdgeQuake MCP Server — entry point.
 *
 * Exposes EdgeQuake Graph-RAG as an MCP server over stdio transport.
 * Also runs a lightweight HTTP server on PORT (default 8082) for health checks.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";

function startHealthServer(port: number): void {
  const http = createHttpServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "mcp-server", version: "0.1.0", transport: "stdio" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  http.listen(port, () => {
    console.error(`[MCP] Health endpoint listening on http://0.0.0.0:${port}/health`);
  });
}

async function main(): Promise<void> {
  const healthPort = parseInt(process.env.PORT ?? "8082", 10);
  startHealthServer(healthPort);

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("EdgeQuake MCP server failed to start:", error);
  process.exit(1);
});
