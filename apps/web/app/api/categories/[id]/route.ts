import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { getCategory, updateCategory, deleteCategory } from "@/lib/categories/store";
import { ErrorCode } from "@/lib/types";

/** GET /api/categories/[id] - Get a single category */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await params;

  try {
    const category = await getCategory(id, userId);
    if (!category) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    return NextResponse.json(category);
  } catch (err) {
    console.error("[categories/[id]] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** PUT /api/categories/[id] - Update a category */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const blocked = checkAntiBot(request, userId);
  if (blocked) return blocked;

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, parentId, description, color } = body as {
      name?: string;
      parentId?: string;
      description?: string;
      color?: string;
    };

    const updated = await updateCategory(id, userId, {
      name: name?.trim(),
      parentId,
      description,
      color,
    });

    if (!updated) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    const error = err as Error & { code?: number };
    if (error.code === 4003) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_CIRCULAR_REFERENCE, message: "Circular reference detected", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }
    console.error("[categories/[id]] PUT error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** DELETE /api/categories/[id] - Delete a category */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await params;

  try {
    const result = await deleteCategory(id, userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[categories/[id]] DELETE error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
