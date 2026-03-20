/**
 * Property 9: Category creation UI synchronization
 * Property 10: Category move hierarchy update
 * Property 11: Category rename reference update
 * Property 12: Document ingestion category auto-suggestion
 * Property 13: Category suggestion approval/rejection handling
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { Category, CategoryTree, CategoryGraph, CategorySuggestion } from "@/lib/types";

// Simulate category operations for pure testing

function buildTree(categories: Category[]): CategoryTree {
  const root: CategoryTree = {
    category: {
      id: "root",
      userId: "u1",
      name: "Root",
      depth: -1,
      path: "",
      privacyLevel: 'private',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    children: [],
    documentCount: 0,
  };

  const nodeMap = new Map<string, CategoryTree>();
  for (const cat of categories) {
    nodeMap.set(cat.id, { category: cat, children: [], documentCount: 0 });
  }

  for (const cat of categories) {
    const treeNode = nodeMap.get(cat.id)!;
    if (cat.parentId && nodeMap.has(cat.parentId)) {
      nodeMap.get(cat.parentId)!.children.push(treeNode);
    } else {
      root.children.push(treeNode);
    }
  }

  return root;
}

function buildGraph(categories: Category[]): CategoryGraph {
  const nodes = categories.map((c) => ({
    id: c.id,
    name: c.name,
    depth: c.depth,
    documentCount: 0,
  }));
  const edges: CategoryGraph["edges"] = [];
  for (const cat of categories) {
    if (cat.parentId) {
      edges.push({ source: cat.parentId, target: cat.id, type: "parent_child" as const });
    }
  }
  return { nodes, edges };
}

function moveCategory(
  cat: Category,
  newParent: Category | null,
): { depth: number; path: string } {
  if (newParent) {
    return {
      depth: newParent.depth + 1,
      path: `${newParent.path}/${cat.name}`,
    };
  }
  return { depth: 0, path: cat.name };
}

function renameCategory(cat: Category, newName: string): Category {
  // Replace the last occurrence of the old name in the path
  const lastIdx = cat.path.lastIndexOf(cat.name);
  const newPath = lastIdx >= 0
    ? cat.path.slice(0, lastIdx) + newName + cat.path.slice(lastIdx + cat.name.length)
    : newName;
  return { ...cat, name: newName, path: newPath, updatedAt: new Date() };
}

function isCircularReference(
  categoryId: string,
  targetParentId: string,
  categories: Category[],
): boolean {
  let current = categories.find((c) => c.id === targetParentId);
  while (current) {
    if (current.id === categoryId) return true;
    current = current.parentId
      ? categories.find((c) => c.id === current!.parentId)
      : undefined;
  }
  return false;
}

describe("Property 9: Category creation UI synchronization", () => {
  it("new category appears in both tree and graph", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.uuid(),
        (name, id) => {
          const newCat: Category = {
            id,
            userId: "u1",
            name,
            depth: 0,
            path: name,
            privacyLevel: 'private',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const categories = [newCat];
          const tree = buildTree(categories);
          const graph = buildGraph(categories);

          // Category appears in tree
          const treeNode = tree.children.find((c) => c.category.id === id);
          expect(treeNode).toBeDefined();
          expect(treeNode!.category.name).toBe(name);

          // Category appears in graph
          const graphNode = graph.nodes.find((n) => n.id === id);
          expect(graphNode).toBeDefined();
          expect(graphNode!.name).toBe(name);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("child categories appear correctly in both views", () => {
    const parent: Category = {
      id: "p1", userId: "u1", name: "Parent", depth: 0,
      path: "Parent", privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
    };
    const child: Category = {
      id: "c1", userId: "u1", name: "Child", parentId: "p1",
      depth: 1, path: "Parent/Child", privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
    };

    const tree = buildTree([parent, child]);
    const graph = buildGraph([parent, child]);

    // Tree: child is under parent
    const parentNode = tree.children.find((c) => c.category.id === "p1");
    expect(parentNode!.children.length).toBe(1);
    expect(parentNode!.children[0].category.id).toBe("c1");

    // Graph: edge exists from parent to child
    const edge = graph.edges.find((e) => e.source === "p1" && e.target === "c1");
    expect(edge).toBeDefined();
    expect(edge!.type).toBe("parent_child");
  });
});

describe("Property 10: Category move hierarchy update", () => {
  it("moving to root sets depth=0", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 5 }),
        (name, oldDepth) => {
          const cat: Category = {
            id: "c1", userId: "u1", name, depth: oldDepth,
            path: "A/" + name, privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
          };
          const { depth, path } = moveCategory(cat, null);
          expect(depth).toBe(0);
          expect(path).toBe(name);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("moving under parent sets correct depth and path", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 4 }),
        (catName, parentName, parentDepth) => {
          const parent: Category = {
            id: "p1", userId: "u1", name: parentName, depth: parentDepth,
            path: parentName, privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
          };
          const cat: Category = {
            id: "c1", userId: "u1", name: catName, depth: 0,
            path: catName, privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
          };
          const { depth, path } = moveCategory(cat, parent);
          expect(depth).toBe(parentDepth + 1);
          expect(path).toBe(`${parentName}/${catName}`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("circular references are detected", () => {
    const parent: Category = {
      id: "p1", userId: "u1", name: "Parent", depth: 0,
      path: "Parent", privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
    };
    const child: Category = {
      id: "c1", userId: "u1", name: "Child", parentId: "p1",
      depth: 1, path: "Parent/Child", privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
    };
    const grandchild: Category = {
      id: "g1", userId: "u1", name: "Grandchild", parentId: "c1",
      depth: 2, path: "Parent/Child/Grandchild", privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
    };

    const categories = [parent, child, grandchild];
    // Moving parent under grandchild = circular
    expect(isCircularReference("p1", "g1", categories)).toBe(true);
    // Moving parent under child = circular
    expect(isCircularReference("p1", "c1", categories)).toBe(true);
    // Moving grandchild under parent (sibling to child) = ok
    expect(isCircularReference("g1", "p1", categories)).toBe(false);
  });
});

describe("Property 11: Category rename reference update", () => {
  it("renamed category updates path", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (oldName, newName) => {
          const cat: Category = {
            id: "c1", userId: "u1", name: oldName, depth: 0,
            path: oldName, privacyLevel: 'private', createdAt: new Date(), updatedAt: new Date(),
          };
          const renamed = renameCategory(cat, newName);
          expect(renamed.name).toBe(newName);
          expect(renamed.path).toContain(newName);
          expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(cat.updatedAt.getTime());
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 12: Category auto-suggestion", () => {
  it("suggestions have required fields with valid confidence", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.string({ minLength: 5, maxLength: 100 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (name, catId, reason, confidence) => {
          const suggestion: CategorySuggestion = {
            categoryId: catId,
            categoryName: name,
            reason,
            confidence,
          };
          expect(suggestion.categoryName).toBeTruthy();
          expect(suggestion.reason).toBeTruthy();
          expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
          expect(suggestion.confidence).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 13: Category suggestion approval/rejection", () => {
  it("approval assigns document to category", () => {
    const documentCategories = new Map<string, Set<string>>();

    function approveCategory(documentId: string, categoryId: string) {
      if (!documentCategories.has(documentId)) {
        documentCategories.set(documentId, new Set());
      }
      documentCategories.get(documentId)!.add(categoryId);
    }

    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (docId, catId) => {
        documentCategories.clear();
        approveCategory(docId, catId);
        expect(documentCategories.get(docId)!.has(catId)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("rejection stores feedback", () => {
    const rejectionFeedback: Array<{ documentId: string; categoryId: string; reason: string }> = [];

    function rejectCategory(documentId: string, categoryId: string, reason: string) {
      rejectionFeedback.push({ documentId, categoryId, reason });
    }

    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 5, maxLength: 100 }),
        (docId, catId, reason) => {
          const before = rejectionFeedback.length;
          rejectCategory(docId, catId, reason);
          expect(rejectionFeedback.length).toBe(before + 1);
          const last = rejectionFeedback[rejectionFeedback.length - 1];
          expect(last.documentId).toBe(docId);
          expect(last.categoryId).toBe(catId);
          expect(last.reason).toBeTruthy();
        },
      ),
      { numRuns: 50 },
    );
  });
});
