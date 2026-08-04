/**
 * SayKnowMind MCP Server — entry point.
 *
 * Supports three transport modes:
 * - StreamableHTTP (POST/GET/DELETE /mcp) — new standard (2025-11-25)
 * - SSE (GET /sse + POST /messages) — deprecated but widely supported
 * - stdio — for local CLI usage (pass --stdio flag)
 */
import { randomUUID, createHash } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import pg from "pg";
import { requestContext } from "./auth-context.js";
import { closeAuditPool } from "./audit.js";
import { createServer } from "./server.js";
import { SessionRegistry } from "./session-registry.js";

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
// Eviction rules and rationale live in session-registry.ts.
type AnyTransport = StreamableHTTPServerTransport | SSEServerTransport;

/** Evict a session after this long with no request touching it. */
const SESSION_IDLE_MS = envInt("MCP_SESSION_IDLE_MS", 30 * 60_000);
/** How often to look for idle sessions. */
const SESSION_SWEEP_MS = envInt("MCP_SESSION_SWEEP_MS", 60_000);
/** Hard ceiling so a misbehaving or hostile client cannot exhaust memory. */
const MAX_SESSIONS = envInt("MCP_MAX_SESSIONS", 256);
/** How long shutdown waits for sessions to close before exiting anyway. */
const SHUTDOWN_TIMEOUT_MS = envInt("MCP_SHUTDOWN_TIMEOUT_MS", 5_000);

const sessions = new SessionRegistry<AnyTransport>({
  idleMs: SESSION_IDLE_MS,
  maxSessions: MAX_SESSIONS,
  onEvict: (sid, reason) => {
    if (reason === "idle") console.log(`[MCP] evicting idle session ${sid}`);
    else
      console.warn(
        `[MCP] session cap ${MAX_SESSIONS} reached — evicting least-recently-used session ${sid}`,
      );
  },
});

// The SDK's standalone GET /mcp stream closes without ever firing
// transport.onclose, and the default web client transport is streamable-http,
// so a listener that stays connected but quiet would look idle to the sweeper.
// Track every open response ourselves: any still-open stream (standalone GET
// SSE or in-flight POST) marks the session active.
const openStreams = new WeakMap<
  StreamableHTTPServerTransport,
  Set<express.Response>
>();

function trackStream(
  transport: StreamableHTTPServerTransport,
  res: express.Response,
): void {
  let set = openStreams.get(transport);
  if (!set) {
    set = new Set();
    openStreams.set(transport, set);
  }
  set.add(res);
  res.on("close", () => {
    set.delete(res);
    // The idle clock starts when the last stream closes, not when it opened.
    const sid = transport.sessionId;
    if (sid) sessions.touch(sid);
  });
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

  const sweeper = setInterval(() => sessions.sweepIdle(), SESSION_SWEEP_MS);
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
          sessions.touch(sessionId);
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
            sessions.register(sid, transport!, server, () => {
              const set = openStreams.get(transport!);
              return set !== undefined && set.size > 0;
            });
          },
        });
        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) sessions.remove(sid);
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

      trackStream(transport, res);
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
    sessions.register(
      transport.sessionId,
      transport,
      server,
      () => !res.writableEnded && !res.destroyed,
    );
    res.on("close", () => {
      void sessions.drop(transport.sessionId);
    });
    await server.connect(transport);
  });

  app.post("/messages", authMiddleware, async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessions.get(sessionId)?.transport;
    if (transport instanceof SSEServerTransport) {
      sessions.touch(sessionId);
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
    const serverClosed = new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    const drained = Promise.allSettled([
      ...sessions.keys().map((sid) => sessions.drop(sid)),
      serverClosed,
    ]);
    // Bounded wait: a wedged transport must not stall the container stop.
    await Promise.race([
      drained,
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref()),
    ]);
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
