import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { getNotifications, getUnreadCount, markAsRead, deleteNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** GET /api/notifications — list notifications */
export async function GET(request: NextRequest) {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(userId, { unreadOnly, limit }),
    getUnreadCount(userId),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

/** PATCH /api/notifications — mark as read */
export async function PATCH(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const ids = Array.isArray(body.ids) ? body.ids : undefined;

  await markAsRead(userId, ids);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/notifications — delete notification(s) */
export async function DELETE(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids : undefined;

  await deleteNotifications(userId, ids);
  return NextResponse.json({ ok: true });
}
