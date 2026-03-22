/**
 * GET /relay/status — Get pending message count and storage stats.
 */
import type { Context } from "hono";
import type { Pool } from "pg";
import { getStatus } from "../storage/relay-store.js";

export async function statusRoute(c: Context, pool: Pool) {
  const tokenPayload = c.get("tokenPayload");

  const status = await getStatus(pool, tokenPayload.sub);

  return c.json({
    pending_count: status.pendingCount,
    oldest_pending: status.oldestPending?.toISOString() ?? null,
    storage_used_bytes: status.storageSizeBytes,
  });
}
