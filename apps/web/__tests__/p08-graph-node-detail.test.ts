/**
 * Property 8: Graph node detail display
 * Verify clicking a graph node shows Entity details and connected documents.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "@/lib/types";

// Simulate graph data lookup
function getNodeDetails(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): { node: GraphNode | undefined; connectedDocs: string[] } {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { node: undefined, connectedDocs: [] };

  const connectedEdges = edges.filter(
    (e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId,
  );

  const connectedNodeIds = connectedEdges.map((e) =>
    e.sourceNodeId === nodeId ? e.targetNodeId : e.sourceNodeId,
  );

  const connectedDocs = nodes
    .filter((n) => connectedNodeIds.includes(n.id) && n.nodeType === "document")
    .map((n) => n.id);

  return { node, connectedDocs };
}

const nodeTypeArb = fc.constantFrom<NodeType>("document", "entity", "category", "concept");
const edgeTypeArb = fc.constantFrom<EdgeType>("mentions", "related_to", "cites", "belongs_to", "similar_to");

const graphNodeArb = fc.record({
  id: fc.uuid(),
  documentId: fc.oneof(fc.uuid(), fc.constant(undefined)),
  entityId: fc.oneof(fc.uuid(), fc.constant(undefined)),
  nodeType: nodeTypeArb,
  properties: fc.record({
    label: fc.string({ minLength: 1, maxLength: 50 }),
    weight: fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constant(undefined)),
  }),
  createdAt: fc.date(),
}) as fc.Arbitrary<GraphNode>;

describe("Property 8: Graph node detail display", () => {
  it("existing node returns details with label", () => {
    fc.assert(
      fc.property(
        fc.array(graphNodeArb, { minLength: 1, maxLength: 10 }),
        (nodes) => {
          const targetNode = nodes[0];
          const { node } = getNodeDetails(targetNode.id, nodes, []);
          expect(node).toBeDefined();
          expect(node!.properties.label).toBeTruthy();
          expect(node!.nodeType).toBeTruthy();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("non-existing node returns undefined", () => {
    fc.assert(
      fc.property(
        fc.array(graphNodeArb, { minLength: 1, maxLength: 10 }),
        fc.uuid(),
        (nodes, randomId) => {
          // Only test if randomId is not in nodes
          if (nodes.some((n) => n.id === randomId)) return;
          const { node } = getNodeDetails(randomId, nodes, []);
          expect(node).toBeUndefined();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("connected documents are correctly identified", () => {
    const entityNode: GraphNode = {
      id: "entity-1",
      entityId: "e1",
      nodeType: "entity",
      properties: { label: "Test Entity" },
      createdAt: new Date(),
    };
    const docNode1: GraphNode = {
      id: "doc-1",
      documentId: "d1",
      nodeType: "document",
      properties: { label: "Document 1" },
      createdAt: new Date(),
    };
    const docNode2: GraphNode = {
      id: "doc-2",
      documentId: "d2",
      nodeType: "document",
      properties: { label: "Document 2" },
      createdAt: new Date(),
    };
    const categoryNode: GraphNode = {
      id: "cat-1",
      nodeType: "category",
      properties: { label: "Category 1" },
      createdAt: new Date(),
    };

    const edges: GraphEdge[] = [
      {
        id: "e1",
        sourceNodeId: "entity-1",
        targetNodeId: "doc-1",
        edgeType: "mentions",
        weight: 0.9,
        properties: {},
        createdAt: new Date(),
      },
      {
        id: "e2",
        sourceNodeId: "doc-2",
        targetNodeId: "entity-1",
        edgeType: "mentions",
        weight: 0.8,
        properties: {},
        createdAt: new Date(),
      },
      {
        id: "e3",
        sourceNodeId: "entity-1",
        targetNodeId: "cat-1",
        edgeType: "belongs_to",
        weight: 0.7,
        properties: {},
        createdAt: new Date(),
      },
    ];

    const nodes = [entityNode, docNode1, docNode2, categoryNode];
    const { node, connectedDocs } = getNodeDetails("entity-1", nodes, edges);

    expect(node).toBeDefined();
    expect(node!.properties.label).toBe("Test Entity");
    expect(connectedDocs).toContain("doc-1");
    expect(connectedDocs).toContain("doc-2");
    expect(connectedDocs).not.toContain("cat-1"); // not a document
    expect(connectedDocs.length).toBe(2);
  });
});
