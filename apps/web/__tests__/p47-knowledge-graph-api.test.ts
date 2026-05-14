import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  pool: { query: mocks.query },
}));

vi.mock("@/lib/ingest/session-helper", () => ({
  getUserIdFromRequest: mocks.getUserIdFromRequest,
}));

let getGraph: typeof import("@/app/api/knowledge/graph/route").GET;
let getNode: typeof import("@/app/api/knowledge/node/[nodeId]/route").GET;

describe("Knowledge graph API", () => {
  beforeAll(async () => {
    getGraph = (await import("@/app/api/knowledge/graph/route")).GET;
    getNode = (await import("@/app/api/knowledge/node/[nodeId]/route")).GET;
  });

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.getUserIdFromRequest.mockResolvedValue("user-1");
  });

  it("finds tag-filtered graph results by tag name and returns document-tag edges", async () => {
    const executedSql: string[] = [];
    mocks.query.mockImplementation(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, " ").toLowerCase();
      executedSql.push(normalized);

      if (normalized.includes("from documents d") && normalized.includes("join document_tags dt")) {
        return { rows: [{ id: "doc-1", title: "React Server Components" }] };
      }

      if (normalized.includes("from documents d")) {
        return { rows: [] };
      }

      if (normalized.includes("select t.id") && normalized.includes("from tags t")) {
        return { rows: [{ id: "tag-1", name: "react-server-components", canonical_name: "react-server-components", document_count: 1 }] };
      }

      if (normalized.includes("select dt.document_id")) {
        return { rows: [{ document_id: "doc-1", tag_id: "tag-1" }] };
      }

      return { rows: [] };
    });

    const response = await getGraph(new NextRequest("http://localhost/api/knowledge/graph?type=tag&search=react-server"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "doc-1", type: "document" }),
      expect.objectContaining({ id: "tag-1", type: "tag", label: "react-server-components" }),
    ]));
    expect(body.edges).toEqual([
      expect.objectContaining({ source: "doc-1", target: "tag-1", type: "tagged_with" }),
    ]);
    expect(executedSql[0]).toContain("entities e");
    expect(executedSql[0]).toContain("document_categories");
    expect(executedSql.some((sql) => sql.includes("join document_tags dt") && sql.includes("t.name ilike"))).toBe(true);
  });

  it("returns entity detail nodes with a stable graph node type and entity subtype metadata", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, " ").toLowerCase();

      if (normalized.includes("from documents d") && normalized.includes("where d.id = $1")) {
        return { rows: [] };
      }

      if (normalized.includes("from entities e") && normalized.includes("where e.id = $1")) {
        return {
          rows: [{
            id: "entity-1",
            name: "OpenAI",
            type: "organization",
            confidence: 0.92,
            properties: { alias: "OpenAI" },
            document_id: "doc-1",
          }],
        };
      }

      if (normalized.includes("join entities e") && normalized.includes("where e.name = $1")) {
        return { rows: [{ id: "doc-1", title: "AI Platform Notes", url: null }] };
      }

      return { rows: [] };
    });

    const response = await getNode(
      new NextRequest("http://localhost/api/knowledge/node/entity-1"),
      { params: Promise.resolve({ nodeId: "entity-1" }) },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      id: "entity-1",
      label: "OpenAI",
      type: "entity",
      properties: {
        entityType: "organization",
        confidence: 0.92,
      },
      connectedDocuments: [{ id: "doc-1", title: "AI Platform Notes" }],
    });
  });
});
