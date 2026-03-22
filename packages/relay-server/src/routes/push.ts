/**
 * POST /relay/push — Store an encrypted blob on the relay.
 */
import type { Context } from "hono";
import type { Pool } from "pg";
import { z } from "zod";
import { isDuplicate, pushMessage } from "../storage/relay-store.js";

const MAX_PAYLOAD_SIZE = parseInt(process.env.MAX_PAYLOAD_SIZE_MB ?? "10", 10) * 1024 * 1024;

const PushSchema = z.object({
  encrypted_payload: z.string().min(1),
  payload_type: z.enum(["document", "category", "entity", "conversation", "message"]).default("document"),
  payload_hash: z.string().min(1),
});

export async function pushRoute(c: Context, pool: Pool) {
  const tokenPayload = c.get("tokenPayload");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = PushSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const { encrypted_payload, payload_type, payload_hash } = parsed.data;

  // Size check
  if (Buffer.byteLength(encrypted_payload, "utf-8") > MAX_PAYLOAD_SIZE) {
    return c.json({ error: `Payload exceeds ${process.env.MAX_PAYLOAD_SIZE_MB ?? 10}MB limit` }, 413);
  }

  // Dedup check
  const duplicate = await isDuplicate(pool, tokenPayload.sub, payload_hash);
  if (duplicate) {
    return c.json({ error: "Duplicate payload already pending" }, 409);
  }

  const result = await pushMessage(
    pool,
    tokenPayload.sub,
    tokenPayload.deviceId,
    encrypted_payload,
    payload_type,
    payload_hash,
  );

  return c.json(
    {
      receipt_id: result.receiptId,
      expires_at: result.expiresAt.toISOString(),
    },
    201,
  );
}
