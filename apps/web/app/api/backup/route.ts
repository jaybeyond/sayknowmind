import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/admin";
import { createBackup, getBackupStatus, cleanOldBackups } from "@/lib/backup/scheduler";
import { ErrorCode } from "@/lib/types";

/**
 * A full backup dumps every tenant's rows, so it must be restricted to platform
 * admins. Returns 401 when unauthenticated, 403 when authenticated but not admin.
 */
async function ensureAdmin(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  try {
    await requireAdmin(session);
  } catch {
    return NextResponse.json(
      { code: ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message: "Admin access required", timestamp: new Date().toISOString() },
      { status: 403 },
    );
  }
  return null;
}

/** GET /api/backup — Get backup status (admin only) */
export async function GET() {
  const denied = await ensureAdmin();
  if (denied) return denied;

  const status = getBackupStatus();
  return NextResponse.json(status);
}

/** POST /api/backup — Trigger manual backup (admin only) */
export async function POST() {
  const denied = await ensureAdmin();
  if (denied) return denied;

  try {
    const result = await createBackup();
    const removed = cleanOldBackups();
    return NextResponse.json({ ...result, oldBackupsRemoved: removed });
  } catch (err) {
    console.error("[backup] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Backup failed", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
