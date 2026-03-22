/**
 * TTL purge job — deletes expired and acknowledged relay messages.
 * Runs every 15 minutes by default.
 */
import type { Pool } from "pg";

export function startPurgeJob(
  pool: Pool,
  intervalMs = 15 * 60 * 1000,
): NodeJS.Timeout {
  const run = async () => {
    try {
      // Delete expired messages (past 24h TTL)
      const expired = await pool.query(
        `DELETE FROM relay_messages WHERE expires_at < NOW() RETURNING id`,
      );

      // Delete acknowledged messages older than 1 hour
      const acked = await pool.query(
        `DELETE FROM relay_messages
         WHERE acknowledged = TRUE
           AND acknowledged_at < NOW() - INTERVAL '1 hour'
         RETURNING id`,
      );

      const total = (expired.rowCount ?? 0) + (acked.rowCount ?? 0);
      if (total > 0) {
        console.log(
          `[relay-purge] Cleaned ${expired.rowCount ?? 0} expired + ${acked.rowCount ?? 0} acknowledged = ${total} messages`,
        );
      }
    } catch (err) {
      console.error("[relay-purge] Purge failed:", err);
    }
  };

  // Run immediately on startup
  run();

  return setInterval(run, intervalMs);
}
