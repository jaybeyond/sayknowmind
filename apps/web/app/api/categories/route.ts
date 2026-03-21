import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { listCategories, createCategory } from "@/lib/categories/store";
import { ErrorCode } from "@/lib/types";

/** GET /api/categories - List all categories for user */
export async function GET(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    const categories = await listCategories(userId);

    // Build tree structure
    const tree = buildTree(categories);
    // Build graph structure
    const graph = buildGraph(categories);

    return NextResponse.json({ categories, tree, graph });
  } catch (err) {
    console.error("[categories] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** POST /api/categories - Create a new category */
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
    const { name, parentId, description, color } = body as {
      name?: string;
      parentId?: string;
      description?: string;
      color?: string;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category name is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const category = await createCategory({
      userId,
      name: name.trim(),
      parentId,
      description,
      color,
    });

    return NextResponse.json({
      categoryId: category.id,
      name: category.name,
      path: category.path.split("/"),
    });
  } catch (err) {
    const error = err as Error & { code?: number };
    if (error.message?.includes("duplicate")) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_DUPLICATE_NAME, message: "Category name already exists", timestamp: new Date().toISOString() },
        { status: 409 },
      );
    }
    console.error("[categories] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

interface CategoryNode {
  category: {
    id: string;
    name: string;
    depth: number;
    path: string;
    parentId: string | null;
  };
  children: CategoryNode[];
  documentCount: number;
}

function buildTree(categories: Array<{ id: string; name: string; parent_id: string | null; depth: number; path: string }>): CategoryNode | null {
  if (categories.length === 0) return null;

  const nodeMap = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  for (const cat of categories) {
    const node: CategoryNode = {
      category: { id: cat.id, name: cat.name, depth: cat.depth, path: cat.path, parentId: cat.parent_id },
      children: [],
      documentCount: 0,
    };
    nodeMap.set(cat.id, node);
  }

  for (const cat of categories) {
    const node = nodeMap.get(cat.id)!;
    if (cat.parent_id && nodeMap.has(cat.parent_id)) {
      nodeMap.get(cat.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Return a virtual root containing all top-level categories
  return {
    category: { id: "root", name: "Categories", depth: -1, path: "", parentId: null },
    children: roots,
    documentCount: 0,
  };
}

function buildGraph(categories: Array<{ id: string; name: string; parent_id: string | null; depth: number }>) {
  const nodes = categories.map((c) => ({
    id: c.id,
    name: c.name,
    depth: c.depth,
    documentCount: 0,
  }));

  const edges: Array<{ source: string; target: string; type: "parent_child" | "related" }> = [];
  for (const cat of categories) {
    if (cat.parent_id) {
      edges.push({ source: cat.parent_id, target: cat.id, type: "parent_child" });
    }
  }

  return { nodes, edges };
}
