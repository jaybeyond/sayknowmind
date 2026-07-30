/**
 * SayKnowMind MCP Server — entry point.
 *
 * Supports three transport modes:
 * - StreamableHTTP (POST/GET/DELETE /mcp) — new standard (2025-11-25)
 * - SSE (GET /sse + POST /messages) — deprecated but widely supported
 * - stdio — for local CLI usage (pass --stdio flag)
 */
import { randomUUID, createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import pg from "pg";
import { requestContext } from "./auth-context.js";
import { closeAuditPool } from "./audit.js";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "8082", 10);
const ADMIN_API_KEY = process.env.MCP_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
// Anonymous (no-auth) HTTP mode must be opted into explicitly — never the
// silent default just because no key/DB happens to be configured.
const ALLOW_ANONYMOUS = process.env.MCP_ALLOW_ANONYMOUS === "true";

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ── Session registry ────────────────────────────────────────
// Each live session pins a whole McpServer (every tool's input schema is
// rebuilt per session), so an entry that is never removed costs hundreds of
// KB for the lifetime of the process.
//
// The SDK only reaches transport.close() — and therefore our onclose cleanup —
// when the client sends an explicit DELETE /mcp. Clients that crash, lose the
// network, or simply stop talking never send it, so the registry MUST expire
// entries on its own. Without the sweeper below this map grows monotonically
// until the container is OOM-killed.
type AnyTransport = StreamableHTTPServerTransport | SSEServerTransport;

interface Session {
  transport: AnyTransport;
  server: McpServer;
  lastSeen: number;
  /** SSE only: a still-open response counts as activity even when idle. */
  isStreamOpen?: () => boolean;
}

const sessions = new Map<string, Session>();

/** Evict a session after this long with no request touching it. */
const SESSION_IDLE_MS = envInt("MCP_SESSION_IDLE_MS", 30 * 60_000);
/** How often to look for idle sessions. */
const SESSION_SWEEP_MS = envInt("MCP_SESSION_SWEEP_MS", 60_000);
/** Hard ceiling so a misbehaving or hostile client cannot exhaust memory. */
const MAX_SESSIONS = envInt("MCP_MAX_SESSIONS", 256);

function registerSession(
  sid: string,
  transport: AnyTransport,
  server: McpServer,
  isStreamOpen?: () => boolean,
): void {
  sessions.set(sid, { transport, server, lastSeen: Date.now(), isStreamOpen });
  evictOverCap();
}

function touchSession(sid: string): void {
  const session = sessions.get(sid);
  if (session) session.lastSeen = Date.now();
}

/**
 * Drop a session and release its transport + server. The map entry is removed
 * first so the transport's own onclose handler is a harmless no-op re-delete.
 */
function dropSession(sid: string): void {
  const session = sessions.get(sid);
  if (!session) return;
  sessions.delete(sid);
  // McpServer.close() cascades to transport.close().
  void Promise.resolve()
    .then(() => session.server.close())
    .catch(() => {
      /* transport already torn down — nothing left to release */
    });
}

function sweepIdleSessions(): void {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    // A live SSE stream is an active client even with no recent messages.
    if (session.isStreamOpen?.()) {
      session.lastSeen = now;
      continue;
    }
    if (now - session.lastSeen > SESSION_IDLE_MS) {
      console.log(`[MCP] evicting idle session ${sid}`);
      dropSession(sid);
    }
  }
}

/** Prefer evicting sessions with no live stream; fall back to plain LRU. */
function evictOverCap(): void {
  while (sessions.size > MAX_SESSIONS) {
    let victim: string | undefined;
    let oldest = Infinity;
    for (const [sid, session] of sessions) {
      if (session.isStreamOpen?.()) continue;
      if (session.lastSeen < oldest) {
        oldest = session.lastSeen;
        victim = sid;
      }
    }
    if (!victim) {
      for (const [sid, session] of sessions) {
        if (session.lastSeen < oldest) {
          oldest = session.lastSeen;
          victim = sid;
        }
      }
    }
    if (!victim) return;
    console.warn(
      `[MCP] session cap ${MAX_SESSIONS} reached — evicting least-recently-used session ${victim}`,
    );
    dropSession(victim);
  }
}

// ── Per-user key lookup (lazy pg pool) ───────────────────────
let pgPool: pg.Pool | undefined;
function getPgPool(): pg.Pool | null {
  if (!DATABASE_URL) return null;
  if (!pgPool) {
    pgPool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 4,
      // Without a timeout, callers queue on an unbounded internal array
      // whenever the DB is slow, and the queue itself becomes a leak.
      connectionTimeoutMillis: envInt("MCP_PG_CONNECT_TIMEOUT_MS", 5_000),
    });
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
    // Keys are stored as SHA-256(token) hex (migration 062), never plaintext.
    const hash = createHash("sha256").update(token).digest("hex");
    const result = await pool.query(
      `SELECT user_id FROM user_mcp_keys WHERE api_key_hash = $1`,
      [hash],
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
//   1. No auth configured:
//        MCP_ALLOW_ANONYMOUS=true  → open mode (dev only)
//        otherwise                 → 401 (refuse — don't silently run open)
//   2. Token matches ADMIN_API_KEY              → allow (no user attached)
//   3. Token found in user_mcp_keys (by hash)   → allow, attach userId
//   4. Otherwise                                → 401
async function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  if (!ADMIN_API_KEY && !DATABASE_URL) {
    if (ALLOW_ANONYMOUS) {
      requestContext.run({ userId: null, rawToken: "", isAdmin: true }, () => next());
    } else {
      res.status(401).json({
        error:
          "MCP server has no auth configured. Set DATABASE_URL (per-user keys) " +
          "or MCP_API_KEY (shared admin key), or set MCP_ALLOW_ANONYMOUS=true to " +
          "explicitly allow anonymous access (dev only).",
      });
    }
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

  const sweeper = setInterval(sweepIdleSessions, SESSION_SWEEP_MS);
  sweeper.unref();

  // Health check (no auth). Session and memory counters are exposed so the
  // leak this endpoint used to hide can be watched from outside the container.
  app.get("/health", (_req, res) => {
    const mem = process.memoryUsage();
    const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
    res.json({
      status: "ok",
      service: "mcp-server",
      version: "0.2.0",
      transports: ["streamable-http", "sse"],
      sessions: {
        active: sessions.size,
        max: MAX_SESSIONS,
        idleTimeoutMs: SESSION_IDLE_MS,
      },
      memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed) },
      uptimeSec: Math.round(process.uptime()),
    });
  });

  // ── StreamableHTTP transport (POST/GET/DELETE /mcp) ────────
  app.all("/mcp", authMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const existing = sessions.get(sessionId)!.transport;
        if (existing instanceof StreamableHTTPServerTransport) {
          transport = existing;
          touchSession(sessionId);
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session uses a different transport" },
            id: null,
          });
          return;
        }
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        const server = createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            registerSession(sid, transport!, server);
          },
        });
        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) sessions.delete(sid);
        };
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
    const server = createServer();
    const transport = new SSEServerTransport("/messages", res);
    registerSession(
      transport.sessionId,
      transport,
      server,
      () => !res.writableEnded && !res.destroyed,
    );
    res.on("close", () => {
      dropSession(transport.sessionId);
    });
    await server.connect(transport);
  });

  app.post("/messages", authMiddleware, async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessions.get(sessionId)?.transport;
    if (transport instanceof SSEServerTransport) {
      touchSession(sessionId);
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).json({ error: "No SSE session found" });
    }
  });

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MCP] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[MCP] StreamableHTTP: POST/GET/DELETE /mcp`);
    console.log(`[MCP] SSE: GET /sse + POST /messages`);
    console.log(`[MCP] Health: GET /health`);
    console.log(
      `[MCP] Sessions: max ${MAX_SESSIONS}, idle eviction after ${Math.round(
        SESSION_IDLE_MS / 1000,
      )}s, swept every ${Math.round(SESSION_SWEEP_MS / 1000)}s`,
    );
    const authModes: string[] = [];
    if (DATABASE_URL) authModes.push("per-user keys (user_mcp_keys table)");
    if (ADMIN_API_KEY) authModes.push("admin/shared MCP_API_KEY");
    if (authModes.length === 0 && ALLOW_ANONYMOUS)
      authModes.push("OPEN — anonymous (MCP_ALLOW_ANONYMOUS=true, dev only)");
    console.log(
      `[MCP] Auth: ${
        authModes.length > 0
          ? authModes.join(" + ")
          : "NONE configured — all requests will 401 (set DATABASE_URL / MCP_API_KEY / MCP_ALLOW_ANONYMOUS)"
      }`,
    );
  });

  // Docker/Railway stop containers with SIGTERM; only handling SIGINT meant
  // every deploy and every OOM restart tore down in-flight requests abruptly.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[MCP] ${signal} received — draining ${sessions.size} session(s)`);
    clearInterval(sweeper);
    httpServer.close();
    for (const sid of [...sessions.keys()]) dropSession(sid);
    await Promise.allSettled([pgPool?.end(), closeAuditPool()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
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
