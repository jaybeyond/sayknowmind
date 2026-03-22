/**
 * POST /relay/ack — Acknowledge receipt of messages (triggers deletion).
 */
import type { Context } from "hono";
import type { Pool } from "pg";
import { z } from "zod";
import { acknowledgeMessages } from "../storage/relay-store.js";

const AckSchema = z.object({
  receipt_ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function ackRoute(c: Context, pool: Pool) {
  const tokenPayload = c.get("tokenPayload");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = AckSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const acknowledged = await acknowledgeMessages(
    pool,
    tokenPayload.sub,
    parsed.data.receipt_ids,
  );

  return c.json({ acknowledged });
}
