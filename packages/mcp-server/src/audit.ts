/**
 * Audit log for MCP tool calls.
 *
 * Every tool call made with a per-user MCP key writes one row to
 * mcp_audit_log so the owning user can review what their key has been
 * doing. Admin/stdio callers (no per-user context) are intentionally
 * not logged — they don't belong to one user and would just bloat the
 * table. Logging is fire-and-forget: a DB outage must not break the
 * actual MCP response.
 */
import pg from "pg";
import { getRequestContext } from "./auth-context.js";

let pool: pg.Pool | undefined;

function getPool(): pg.Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      // Audit writes are fire-and-forget, so a slow DB applies no backpressure
      // to callers. Without a timeout every waiting write piles onto pg's
      // unbounded internal queue and that queue becomes the leak.
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (err) => console.error("[MCP audit] pg pool error:", err));
  }
  return pool;
}

/** Release the audit pool on shutdown. Safe to call when it was never opened. */
export async function closeAuditPool(): Promise<void> {
  const p = pool;
  pool = undefined;
  if (p) await p.end().catch(() => undefined);
}

export type AuditStatus = "ok" | "error" | "blocked";

interface AuditEntry {
  userId: string;
  toolName: string;
  status: AuditStatus;
  durationMs: number;
  errorMessage?: string;
}

async function writeAudit(entry: AuditEntry): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO mcp_audit_log (user_id, tool_name, status, duration_ms, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.userId, entry.toolName, entry.status, entry.durationMs, entry.errorMessage ?? null],
    );
  } catch (err) {
    // Audit failure must never propagate to the tool response.
    console.error("[MCP audit] insert failed:", err);
  }
}

/**
 * Classify a tool result envelope into an audit status. The isolation
 * gate returns isError: true with a JSON payload that contains
 * "user_isolation_unimplemented"; treat that as "blocked" so it shows
 * up distinctly from real failures in the audit feed.
 */
function classifyResult(result: unknown): { status: AuditStatus; errorMessage?: string } {
  if (!result || typeof result !== "object") return { status: "ok" };
  const r = result as { isError?: boolean; content?: Array<{ text?: string }> };
  if (!r.isError) return { status: "ok" };
  const text = r.content?.[0]?.text ?? "";
  if (text.includes("user_isolation_unimplemented")) {
    return { status: "blocked", errorMessage: "isolation gate" };
  }
  return { status: "error", errorMessage: text.slice(0, 500) };
}

/**
 * Wrap a tool handler so each call lands in mcp_audit_log when it was
 * authenticated as a real end-user. Returns a handler with the same
 * shape so it slots into McpServer.tool() unchanged.
 */
export function withAudit<TArgs extends unknown[], TResult>(
  toolName: string,
  handler: (...args: TArgs) => Promise<TResult> | TResult,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    const start = Date.now();
    const userId = getRequestContext()?.userId;
    try {
      const result = await handler(...args);
      if (userId) {
        const { status, errorMessage } = classifyResult(result);
        void writeAudit({
          userId,
          toolName,
          status,
          durationMs: Date.now() - start,
          errorMessage,
        });
      }
      return result;
    } catch (err) {
      if (userId) {
        void writeAudit({
          userId,
          toolName,
          status: "error",
          durationMs: Date.now() - start,
          errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        });
      }
      throw err;
    }
  };
}
