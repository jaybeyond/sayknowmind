import { pool } from "@/lib/db";

export type NotificationType = "job_complete" | "related_found" | "category_assigned" | "job_failed" | "system";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

/** Create a notification for a user */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [userId, type, title, body ?? null, JSON.stringify(metadata ?? {})],
  );
  const id = result.rows[0].id;

  // Push to SSE listeners
  pushToListeners(userId, {
    id,
    userId,
    type,
    title,
    body: body ?? null,
    metadata: metadata ?? {},
    read: false,
    createdAt: new Date().toISOString(),
  });

  return id;
}

/** Get notifications for a user (newest first) */
export async function getNotifications(
  userId: string,
  opts?: { unreadOnly?: boolean; limit?: number },
): Promise<Notification[]> {
  const limit = opts?.limit ?? 50;
  const whereClause = opts?.unreadOnly ? "AND read = FALSE" : "";

  const result = await pool.query(
    `SELECT id, user_id, type, title, body, metadata, read, created_at
     FROM notifications
     WHERE user_id = $1 ${whereClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.rows.map(rowToNotification);
}

/** Get unread count */
export async function getUnreadCount(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = FALSE`,
    [userId],
  );
  return parseInt(result.rows[0].count, 10);
}

/** Mark notification(s) as read */
export async function markAsRead(userId: string, notificationIds?: string[]): Promise<void> {
  if (notificationIds?.length) {
    await pool.query(
      `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, notificationIds],
    );
  } else {
    // Mark all as read
    await pool.query(
      `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
      [userId],
    );
  }
}

function rowToNotification(row: Record<string, unknown>): Notification {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.type) as NotificationType,
    title: String(row.title),
    body: row.body ? String(row.body) : null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    read: Boolean(row.read),
    createdAt: String(row.created_at),
  };
}

// ── SSE Listener Registry ────────────────────────────────────────

type SSEListener = (notification: Notification) => void;
const listeners = new Map<string, Set<SSEListener>>();

export function addSSEListener(userId: string, listener: SSEListener): () => void {
  if (!listeners.has(userId)) listeners.set(userId, new Set());
  listeners.get(userId)!.add(listener);
  return () => {
    listeners.get(userId)?.delete(listener);
    if (listeners.get(userId)?.size === 0) listeners.delete(userId);
  };
}

function pushToListeners(userId: string, notification: Notification): void {
  const userListeners = listeners.get(userId);
  if (userListeners) {
    for (const listener of userListeners) {
      try { listener(notification); } catch { /* ignore */ }
    }
  }
}
