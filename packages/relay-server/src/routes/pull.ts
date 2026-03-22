/**
 * GET /relay/pull — Fetch pending encrypted messages for a user.
 */
import type { Context } from "hono";
import type { Pool } from "pg";
import { pullMessages } from "../storage/relay-store.js";

export async function pullRoute(c: Context, pool: Pool) {
  const tokenPayload = c.get("tokenPayload");

  const sinceParam = c.req.query("since");
  const limitParam = c.req.query("limit");

  const since = sinceParam ? new Date(sinceParam) : undefined;
  const limit = Math.min(parseInt(limitParam ?? "50", 10), 100);

  if (since && isNaN(since.getTime())) {
    return c.json({ error: "Invalid 'since' parameter — must be ISO timestamp" }, 400);
  }

  const result = await pullMessages(pool, tokenPayload.sub, since, limit);

  return c.json({
    messages: result.messages.map((m) => ({
      receipt_id: m.id,
      encrypted_payload: m.encryptedPayload,
      payload_type: m.payloadType,
      payload_hash: m.payloadHash,
      source_device_id: m.deviceId,
      created_at: m.createdAt.toISOString(),
    })),
    has_more: result.hasMore,
  });
}
