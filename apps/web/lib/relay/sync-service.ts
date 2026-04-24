/**
 * Relay sync service — orchestrates push/pull between local server and cloud relay.
 * Runs as background process on the local server.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { encryptForUser, decryptForUser } from "@/lib/encryption";
import { RelayClient } from "./client";
import { detectConflict, resolveConflict } from "./conflict-resolver";
import { isRelayConfigured, getRelayUrl, issueRelayToken, getDeviceId } from "./token";
import type { SyncPayload } from "./types";

/** Raw row shape from sync_ledger SQL query (snake_case). */
interface SyncLedgerRow {
  id: string;
  document_id: string | null;
  action: string;
  entity_type: string;
}

const SYNC_INTERVAL = parseInt(process.env.RELAY_SYNC_INTERVAL_MS ?? "60000", 10);

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Get a relay client instance for a user.
 */
function getClient(userId: string): RelayClient | null {
  if (!isRelayConfigured()) return null;
  const relayUrl = getRelayUrl();
  if (!relayUrl) return null;
  const token = issueRelayToken(userId);
  return new RelayClient(relayUrl, token);
}

/**
 * Record a document change in the sync ledger (called by document-store hooks).
 */
export async function recordSyncEvent(
  pool: Pool,
  userId: string,
  documentId: string,
  action: "create" | "update" | "delete",
): Promise<void> {
  if (!isRelayConfigured()) return;

  await pool.query(
    `INSERT INTO sync_ledger (user_id, document_id, action, entity_type, status)
     VALUES ($1, $2, $3, 'document', 'pending')`,
    [userId, documentId, action],
  );
}

/**
 * Push pending local changes to the relay.
 */
export async function pushPendingChanges(
  pool: Pool,
  userId: string,
): Promise<{ pushed: number; errors: string[] }> {
  const client = getClient(userId);
  if (!client) return { pushed: 0, errors: [] };

  const errors: string[] = [];
  let pushed = 0;

  // Fetch pending ledger entries
  const result = await pool.query<SyncLedgerRow>(
    `SELECT id, document_id, action, entity_type
     FROM sync_ledger
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 50`,
    [userId],
  );

  for (const entry of result.rows) {
    try {
      let payloadData: Record<string, unknown>;

      if (entry.action === "delete") {
        payloadData = { id: entry.document_id };
      } else {
        // Fetch document
        const doc = await pool.query(
          `SELECT id, title, content, summary, url, source_type, metadata, privacy_level, created_at, updated_at
           FROM documents WHERE id = $1 AND user_id = $2`,
          [entry.document_id, userId],
        );
        if (doc.rows.length === 0) {
          // Document deleted between ledger insert and push
          await pool.query(
            `UPDATE sync_ledger SET status = 'failed', synced_at = NOW() WHERE id = $1`,
            [entry.id],
          );
          continue;
        }
        payloadData = doc.rows[0];
      }

      const payloadJson = JSON.stringify({
        type: entry.entity_type as SyncPayload["type"],
        action: entry.action as SyncPayload["action"],
        data: payloadData,
        timestamp: Date.now(),
        hash: sha256(JSON.stringify(payloadData)),
      });

      const encrypted = encryptForUser(userId, payloadJson);
      const payloadHash = sha256(encrypted);

      const pushResult = await client.push(encrypted, entry.entity_type ?? "document", payloadHash);

      await pool.query(
        `UPDATE sync_ledger
         SET status = 'pushed', relay_receipt_id = $2, payload_hash = $3, synced_at = NOW()
         WHERE id = $1`,
        [entry.id, pushResult.receipt_id, payloadHash],
      );

      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to push ${entry.document_id}: ${msg}`);
      await pool.query(
        `UPDATE sync_ledger SET status = 'failed', synced_at = NOW() WHERE id = $1`,
        [entry.id],
      );
    }
  }

  return { pushed, errors };
}

/**
 * Pull pending changes from the relay and apply them locally.
 */
export async function pullFromRelay(
  pool: Pool,
  userId: string,
): Promise<{ pulled: number; conflicts: number; errors: string[] }> {
  const client = getClient(userId);
  if (!client) return { pulled: 0, conflicts: 0, errors: [] };

  const errors: string[] = [];
  let pulled = 0;
  let conflicts = 0;
  const ackIds: string[] = [];

  try {
    const result = await client.pull();

    for (const msg of result.messages) {
      try {
        // Skip messages from our own device
        if (msg.source_device_id === getDeviceId()) {
          ackIds.push(msg.receipt_id);
          continue;
        }

        // Decrypt
        const payloadJson = decryptForUser(userId, msg.encrypted_payload);
        const payload = JSON.parse(payloadJson) as SyncPayload;

        // Dedup: check if we already have this hash
        const existing = await pool.query(
          `SELECT 1 FROM sync_ledger
           WHERE user_id = $1 AND payload_hash = $2 AND status IN ('pulled', 'confirmed')
           LIMIT 1`,
          [userId, msg.payload_hash],
        );
        if ((existing.rowCount ?? 0) > 0) {
          ackIds.push(msg.receipt_id);
          continue;
        }

        if (payload.action === "create") {
          await applyCreate(pool, userId, payload);
        } else if (payload.action === "update") {
          const conflictResult = await applyUpdate(pool, userId, payload, msg.source_device_id);
          if (conflictResult) conflicts++;
        } else if (payload.action === "delete") {
          await applyDelete(pool, userId, payload);
        }

        // Record in ledger
        await pool.query(
          `INSERT INTO sync_ledger (user_id, document_id, action, entity_type, payload_hash, relay_receipt_id, status, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pulled', NOW())`,
          [
            userId,
            (payload.data as { id?: string }).id ?? null,
            payload.action,
            payload.type,
            msg.payload_hash,
            msg.receipt_id,
          ],
        );

        ackIds.push(msg.receipt_id);
        pulled++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to process message ${msg.receipt_id}: ${errMsg}`);
      }
    }

    // Acknowledge all successfully processed messages
    if (ackIds.length > 0) {
      await client.ack(ackIds);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    errors.push(`Pull failed: ${errMsg}`);
  }

  return { pulled, conflicts, errors };
}

// ---------------------------------------------------------------------------
// Apply operations
// ---------------------------------------------------------------------------

async function applyCreate(pool: Pool, userId: string, payload: SyncPayload): Promise<void> {
  const data = payload.data as {
    id?: string;
    title?: string;
    content?: string;
    summary?: string;
    url?: string;
    source_type?: string;
    metadata?: Record<string, unknown>;
    privacy_level?: string;
  };

  await pool.query(
    `INSERT INTO documents (id, user_id, title, content, summary, url, source_type, metadata, privacy_level)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8::jsonb, COALESCE($9, 'private'))
     ON CONFLICT (id) DO NOTHING`,
    [
      data.id ?? null,
      userId,
      data.title ?? "Untitled",
      data.content ?? "",
      data.summary ?? null,
      data.url ?? null,
      data.source_type ?? "text",
      JSON.stringify(data.metadata ?? {}),
      data.privacy_level ?? "private",
    ],
  );
}

async function applyUpdate(
  pool: Pool,
  userId: string,
  payload: SyncPayload,
  sourceDeviceId: string,
): Promise<boolean> {
  const data = payload.data as { id?: string; updated_at?: string; metadata?: Record<string, unknown> };
  if (!data.id) return false;

  // Check for conflicts
  const local = await pool.query(
    `SELECT id, updated_at, metadata->>'sync_hash' AS sync_hash
     FROM documents WHERE id = $1 AND user_id = $2`,
    [data.id, userId],
  );

  if (local.rows.length > 0) {
    const localDoc = {
      id: local.rows[0].id,
      updatedAt: local.rows[0].updated_at,
      syncHash: local.rows[0].sync_hash ?? undefined,
    };

    const conflict = detectConflict(localDoc, payload, sourceDeviceId);
    if (conflict) {
      // Default: last_write_wins
      const resolution = resolveConflict(conflict, "last_write_wins");
      if (resolution.winner === "local") return true;
    }
  }

  // Apply update
  const sets: string[] = [];
  const params: unknown[] = [data.id, userId];
  let idx = 3;

  for (const field of ["title", "content", "summary", "url", "privacy_level"] as const) {
    if (field in data) {
      sets.push(`${field} = $${idx}`);
      params.push((data as Record<string, unknown>)[field]);
      idx++;
    }
  }

  if (data.metadata) {
    sets.push(`metadata = metadata || $${idx}::jsonb`);
    params.push(JSON.stringify(data.metadata));
    idx++;
  }

  if (sets.length > 0) {
    sets.push("updated_at = NOW()");
    await pool.query(
      `UPDATE documents SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`,
      params,
    );
  }

  return false;
}

async function applyDelete(pool: Pool, userId: string, payload: SyncPayload): Promise<void> {
  const data = payload.data as { id?: string };
  if (!data.id) return;

  await pool.query(
    `DELETE FROM documents WHERE id = $1 AND user_id = $2`,
    [data.id, userId],
  );
}

/**
 * Get the current relay sync status for a user.
 */
export async function getRelaySyncStatus(
  pool: Pool,
  userId: string,
): Promise<{
  enabled: boolean;
  relayUrl: string | null;
  pendingPush: number;
  lastPull: string | null;
  lastPush: string | null;
}> {
  const enabled = isRelayConfigured();
  const relayUrl = getRelayUrl();

  if (!enabled) {
    return { enabled: false, relayUrl: null, pendingPush: 0, lastPull: null, lastPush: null };
  }

  const pending = await pool.query(
    `SELECT COUNT(*) AS cnt FROM sync_ledger WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );

  const lastPush = await pool.query(
    `SELECT synced_at FROM sync_ledger
     WHERE user_id = $1 AND status IN ('pushed', 'confirmed')
     ORDER BY synced_at DESC LIMIT 1`,
    [userId],
  );

  const lastPull = await pool.query(
    `SELECT synced_at FROM sync_ledger
     WHERE user_id = $1 AND status = 'pulled'
     ORDER BY synced_at DESC LIMIT 1`,
    [userId],
  );

  return {
    enabled,
    relayUrl,
    pendingPush: parseInt(pending.rows[0].cnt, 10),
    lastPush: lastPush.rows[0]?.synced_at?.toISOString() ?? null,
    lastPull: lastPull.rows[0]?.synced_at?.toISOString() ?? null,
  };
}
