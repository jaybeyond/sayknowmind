import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { checkAntiBot } from "@/lib/antibot";
import { getCategory, updateCategory, deleteCategory } from "@/lib/categories/store";
import { ErrorCode } from "@/lib/types";

/** GET /api/categories/[id] - Get a single category */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const { id } = await params;

    const category = await getCategory(id, ctx);
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
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const blocked = checkAntiBot(request, ctx.userId);
    if (blocked) return blocked;

    const { id } = await params;

    const body = await request.json();
    const { name, parentId, description, color } = body as {
      name?: string;
      parentId?: string;
      description?: string;
      color?: string;
    };

    const updated = await updateCategory(id, ctx, {
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
    const error = err as Error & { code?: number | string };
    if (error.code === 4003) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_CIRCULAR_REFERENCE, message: "Circular reference detected", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }
    if (error.code === "23505") {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_DUPLICATE_NAME, message: "Category name already exists", timestamp: new Date().toISOString() },
        { status: 409 },
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
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const { id } = await params;

    const result = await deleteCategory(id, ctx);
    if (!result.success) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[categories/[id]] DELETE error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
