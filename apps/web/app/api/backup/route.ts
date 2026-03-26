import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { createBackup, getBackupStatus, cleanOldBackups } from "@/lib/backup/scheduler";
import { ErrorCode } from "@/lib/types";

/** GET /api/backup — Get backup status */
export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const status = getBackupStatus();
  return NextResponse.json(status);
}

/** POST /api/backup — Trigger manual backup */
export async function POST() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

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
