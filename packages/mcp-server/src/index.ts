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
import pg from "pg";
import { requestContext } from "./auth-context.js";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "8082", 10);
const ADMIN_API_KEY = process.env.MCP_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// ── Transport registry ──────────────────────────────────────
type AnyTransport = StreamableHTTPServerTransport | SSEServerTransport;
const transports: Record<string, AnyTransport> = {};

// ── Per-user key lookup (lazy pg pool) ───────────────────────
let pgPool: pg.Pool | undefined;
function getPgPool(): pg.Pool | null {
  if (!DATABASE_URL) return null;
  if (!pgPool) {
    pgPool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    pgPool.on("error", (err) => console.error("[MCP] pg pool error:", err));
  }
  return pgPool;
}

/**
 * Look up the user that owns a given API key. Returns the userId
 * string on match, or null otherwise. Keys ship as `sk-mcp-<hex>`
 * (see apps/web/app/api/user/mcp-key/route.ts).
 */
async function findUserByApiKey(token: string): Promise<string | null> {
  const pool = getPgPool();
  if (!pool) return null;
  try {
    const result = await pool.query(
      `SELECT user_id FROM user_mcp_keys WHERE api_key = $1`,
      [token],
    );
    return (result.rows[0]?.user_id as string) ?? null;
  } catch (err) {
    console.error("[MCP] user_mcp_keys lookup failed:", err);
    return null;
  }
}

function extractAuthToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = req.query.api_key;
  return typeof apiKey === "string" ? apiKey : undefined;
}

// ── Auth middleware ──────────────────────────────────────────
// Priority:
//   1. No ADMIN_API_KEY *and* no DATABASE_URL  → open mode (dev only)
//   2. Token matches ADMIN_API_KEY              → allow (no user attached)
//   3. Token found in user_mcp_keys             → allow, attach userId
//   4. Otherwise                                → 401
async function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  if (!ADMIN_API_KEY && !DATABASE_URL) {
    requestContext.run({ userId: null, rawToken: "", isAdmin: true }, () => next());
    return;
  }

  const token = extractAuthToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (ADMIN_API_KEY && token === ADMIN_API_KEY) {
    // Admin/legacy shared key — does not correspond to a single user.
    requestContext.run({ userId: null, rawToken: token, isAdmin: true }, () => next());
    return;
  }

  const userId = await findUserByApiKey(token);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Attach userId to req so MCP tools can scope EdgeQuake calls per
  // user when that wiring is added (currently tools share the global
  // tenant/workspace — see client.ts).
  (req as unknown as { userId?: string }).userId = userId;
  requestContext.run({ userId, rawToken: token, isAdmin: false }, () => next());
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
    const authModes: string[] = [];
    if (DATABASE_URL) authModes.push("per-user keys (user_mcp_keys table)");
    if (ADMIN_API_KEY) authModes.push("admin/shared MCP_API_KEY");
    console.log(
      `[MCP] Auth: ${
        authModes.length > 0 ? authModes.join(" + ") : "open (no DATABASE_URL or MCP_API_KEY set)"
      }`,
    );
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
