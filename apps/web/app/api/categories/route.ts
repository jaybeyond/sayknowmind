import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { checkAntiBot } from "@/lib/antibot";
import { listCategories, createCategory } from "@/lib/categories/store";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause } from "@/lib/visibility";
import { ensureKnowledgeSchema } from "@/lib/schema-compat";

/** GET /api/categories - List all categories for user */
export async function GET(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    await ensureKnowledgeSchema();
    const categories = await listCategories(ctx);

    // Get document counts per category
    // $1 = userId, $2 = organizationId
    const countResult = await pool.query(
      `SELECT dc.category_id, COUNT(*)::int as count
       FROM document_categories dc
       JOIN categories c ON c.id = dc.category_id
       JOIN documents d ON d.id = dc.document_id
       WHERE ${readableClause("c", 2, 1, "category")} AND ${readableClause("d", 2, 1, "document")}
       GROUP BY dc.category_id`,
      [ctx.userId, ctx.organizationId],
    );
    const docCounts = new Map<string, number>(
      countResult.rows.map((r: { category_id: string; count: number }) => [r.category_id, r.count]),
    );

    // Build tree structure
    const tree = buildTree(categories, docCounts);
    // Build graph structure
    const graph = buildGraph(categories, docCounts);

    // Counts on the flat list too — the sidebar folder rows consume this shape.
    const categoriesWithCounts = categories.map((c) => ({
      ...c,
      documentCount: docCounts.get(c.id) ?? 0,
    }));

    return NextResponse.json({ categories: categoriesWithCounts, tree, graph });
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
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const blocked = checkAntiBot(request, ctx.userId);
  if (blocked) return blocked;

  try {
    await ensureKnowledgeSchema();
    const body = await request.json();
    const { name, parentId, description, color, kind } = body as {
      name?: string;
      parentId?: string;
      description?: string;
      color?: string;
      kind?: string;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category name is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const category = await createCategory({
      ctx,
      name: name.trim(),
      parentId,
      description,
      color,
      kind,
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

function buildTree(
  categories: Array<{ id: string; name: string; parent_id: string | null; depth: number; path: string }>,
  docCounts: Map<string, number> = new Map(),
): CategoryNode | null {
  if (categories.length === 0) return null;

  const nodeMap = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  for (const cat of categories) {
    const node: CategoryNode = {
      category: { id: cat.id, name: cat.name, depth: cat.depth, path: cat.path, parentId: cat.parent_id },
      children: [],
      documentCount: docCounts.get(cat.id) ?? 0,
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

function buildGraph(
  categories: Array<{ id: string; name: string; parent_id: string | null; depth: number }>,
  docCounts: Map<string, number> = new Map(),
) {
  const nodes = categories.map((c) => ({
    id: c.id,
    name: c.name,
    depth: c.depth,
    documentCount: docCounts.get(c.id) ?? 0,
  }));

  const edges: Array<{ source: string; target: string; type: "parent_child" | "related" }> = [];
  for (const cat of categories) {
    if (cat.parent_id) {
      edges.push({ source: cat.parent_id, target: cat.id, type: "parent_child" });
    }
  }

  return { nodes, edges };
}
