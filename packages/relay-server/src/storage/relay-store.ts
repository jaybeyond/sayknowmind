/**
 * Relay message storage — PostgreSQL CRUD for encrypted blobs.
 * All payloads are opaque base64 strings — the relay never decrypts.
 */
import type { Pool } from "pg";

export interface RelayMessage {
  id: string;
  userId: string;
  deviceId: string;
  encryptedPayload: string;
  payloadType: string;
  payloadHash: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Check for duplicate payload (same user + same hash).
 */
export async function isDuplicate(
  pool: Pool,
  userId: string,
  payloadHash: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM relay_messages
     WHERE user_id = $1 AND payload_hash = $2
       AND acknowledged = FALSE AND expires_at > NOW()
     LIMIT 1`,
    [userId, payloadHash],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Store an encrypted message on the relay.
 */
export async function pushMessage(
  pool: Pool,
  userId: string,
  deviceId: string,
  encryptedPayload: string,
  payloadType: string,
  payloadHash: string,
): Promise<{ receiptId: string; expiresAt: Date }> {
  const result = await pool.query(
    `INSERT INTO relay_messages (user_id, device_id, encrypted_payload, payload_type, payload_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, expires_at`,
    [userId, deviceId, encryptedPayload, payloadType, payloadHash],
  );
  const row = result.rows[0];
  return { receiptId: row.id, expiresAt: row.expires_at };
}

/**
 * Pull pending (unacknowledged, non-expired) messages for a user.
 */
export async function pullMessages(
  pool: Pool,
  userId: string,
  since?: Date,
  limit = 50,
): Promise<{ messages: RelayMessage[]; hasMore: boolean }> {
  const sinceClause = since ? `AND created_at > $3` : "";
  const params: unknown[] = [userId, limit + 1];
  if (since) params.push(since);

  const result = await pool.query(
    `SELECT id, user_id, device_id, encrypted_payload, payload_type, payload_hash, created_at, expires_at
     FROM relay_messages
     WHERE user_id = $1
       AND acknowledged = FALSE
       AND expires_at > NOW()
       ${sinceClause}
     ORDER BY created_at ASC
     LIMIT $2`,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

  return {
    messages: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      deviceId: r.device_id,
      encryptedPayload: r.encrypted_payload,
      payloadType: r.payload_type,
      payloadHash: r.payload_hash,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })),
    hasMore,
  };
}

/**
 * Acknowledge (confirm receipt of) messages — marks them for deletion.
 */
export async function acknowledgeMessages(
  pool: Pool,
  userId: string,
  receiptIds: string[],
): Promise<number> {
  if (receiptIds.length === 0) return 0;

  const placeholders = receiptIds.map((_, i) => `$${i + 2}`).join(", ");
  const result = await pool.query(
    `UPDATE relay_messages
     SET acknowledged = TRUE, acknowledged_at = NOW()
     WHERE user_id = $1 AND id IN (${placeholders})
       AND acknowledged = FALSE
     RETURNING id`,
    [userId, ...receiptIds],
  );
  return result.rowCount ?? 0;
}

/**
 * Get pending message count and storage stats for a user.
 */
export async function getStatus(
  pool: Pool,
  userId: string,
): Promise<{
  pendingCount: number;
  oldestPending: Date | null;
  storageSizeBytes: number;
}> {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS pending_count,
       MIN(created_at) AS oldest_pending,
       COALESCE(SUM(LENGTH(encrypted_payload)), 0) AS storage_size
     FROM relay_messages
     WHERE user_id = $1
       AND acknowledged = FALSE
       AND expires_at > NOW()`,
    [userId],
  );
  const row = result.rows[0];
  return {
    pendingCount: parseInt(row.pending_count, 10),
    oldestPending: row.oldest_pending ?? null,
    storageSizeBytes: parseInt(row.storage_size, 10),
  };
}
