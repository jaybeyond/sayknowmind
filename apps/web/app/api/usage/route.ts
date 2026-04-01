import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { getUsageStatus } from "@/lib/usage-limit";

export const dynamic = "force-dynamic";

/** GET /api/usage — current daily usage status */
export async function GET() {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getUsageStatus(userId);
    return NextResponse.json(status);
  } catch (err) {
    console.error("[usage] Error:", err);
    return NextResponse.json(
      { allowed: true, hasOwnKeys: false, used: 0, limit: 10, remaining: 10 },
    );
  }
}
