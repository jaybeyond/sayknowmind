import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { mergeCategories } from "@/lib/categories/store";
import { ErrorCode } from "@/lib/types";

/** POST /api/categories/merge - Merge multiple categories into one */
export async function POST(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const blocked = checkAntiBot(request, userId);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const { sourceIds, targetId } = body as {
      sourceIds?: string[];
      targetId?: string;
    };

    if (!sourceIds?.length || !targetId) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "sourceIds and targetId are required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const result = await mergeCategories(sourceIds, targetId, userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[categories/merge] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
