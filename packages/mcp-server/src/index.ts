/**
 * SayKnowMind MCP Server — entry point.
 *
 * Supports three transport modes:
 * - StreamableHTTP (POST/GET/DELETE /mcp) — new standard (2025-11-25)
 * - SSE (GET /sse + POST /messages) — deprecated but widely supported
 * - stdio — for local CLI usage (pass --stdio flag)
 */
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "8082", 10);
const API_KEY = process.env.MCP_API_KEY;

// ── Transport registry ──────────────────────────────────────
type AnyTransport = StreamableHTTPServerTransport | SSEServerTransport;
const transports: Record<string, AnyTransport> = {};

// ── Auth middleware ──────────────────────────────────────────
function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!API_KEY) return next(); // no key configured = open access
  const token =
    req.headers.authorization?.replace("Bearer ", "") ??
    (req.query.api_key as string);
  if (token !== API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── HTTP server ─────────────────────────────────────────────
function startHttpServer(): void {
  const app = express();
  app.use(express.json());

  // Health check (no auth)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "mcp-server",
      version: "0.2.0",
      transports: ["streamable-http", "sse"],
    });
  });

  // ── StreamableHTTP transport (POST/GET/DELETE /mcp) ────────
  app.all("/mcp", authMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        const existing = transports[sessionId];
        if (existing instanceof StreamableHTTPServerTransport) {
          transport = existing;
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session uses a different transport" },
            id: null,
          });
          return;
        }
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport!;
          },
        });
        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) delete transports[sid];
        };
        const server = createServer();
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // ── SSE transport (GET /sse + POST /messages) ──────────────
  app.get("/sse", authMiddleware, async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
      delete transports[transport.sessionId];
    });
    const server = createServer();
    await server.connect(transport);
  });

  app.post("/messages", authMiddleware, async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    if (transport instanceof SSEServerTransport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).json({ error: "No SSE session found" });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MCP] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[MCP] StreamableHTTP: POST/GET/DELETE /mcp`);
    console.log(`[MCP] SSE: GET /sse + POST /messages`);
    console.log(`[MCP] Health: GET /health`);
    console.log(`[MCP] Auth: ${API_KEY ? "API key required" : "open (no MCP_API_KEY set)"}`);
  });

  process.on("SIGINT", async () => {
    for (const sid of Object.keys(transports)) {
      try { await transports[sid].close(); } catch { /* ignore */ }
      delete transports[sid];
    }
    process.exit(0);
  });
}

// ── Main ────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (process.argv.includes("--stdio")) {
    // Local stdio mode (for Claude Code, etc.)
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    // HTTP mode (for Railway deployment)
    startHttpServer();
  }
}

main().catch((error) => {
  console.error("MCP server failed to start:", error);
  process.exit(1);
});
