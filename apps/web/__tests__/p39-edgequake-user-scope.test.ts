/**
 * Property 39: EdgeQuake requests carry SayKnowMind user scope out-of-band.
 *
 * User/tenant/workspace scope must be sent as headers, not leaked into the
 * EdgeQuake query JSON schema. Indexing must also preserve the owner user_id
 * in metadata so future EdgeQuake workspace migration can re-scope data.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexDocument, queryEdgeQuake } from "@/lib/edgequake/client";

const emptyQueryResponse = {
  answer: "",
  mode: "naive",
  sources: [],
  stats: {
    embedding_time_ms: 0,
    retrieval_time_ms: 0,
    generation_time_ms: 0,
    total_time_ms: 0,
    sources_retrieved: 0,
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Property 39: EdgeQuake user scope propagation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends query scope as headers while keeping the EdgeQuake JSON schema clean", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(emptyQueryResponse));
    vi.stubGlobal("fetch", fetchMock);

    await queryEdgeQuake({
      query: "tenant isolation",
      mode: "naive",
      userId: "user-123",
      tenantId: "tenant-456",
      workspaceId: "workspace-789",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-User-ID": "user-123",
      "X-Tenant-ID": "tenant-456",
      "X-Workspace-ID": "workspace-789",
    });

    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      query: "tenant isolation",
      mode: "naive",
      include_references: true,
    });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("workspaceId");
  });

  it("indexes documents with owner metadata and matching EdgeQuake scope headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        document_id: "eq-doc-1",
        status: "completed",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await indexDocument({
      content: "private user note",
      title: "Private note",
      document_id: "skm-doc-1",
      userId: "user-123",
      tenantId: "tenant-456",
      workspaceId: "workspace-789",
      metadata: {
        language: "ko",
        user_id: "stale-user",
      },
      async_processing: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      "X-User-ID": "user-123",
      "X-Tenant-ID": "tenant-456",
      "X-Workspace-ID": "workspace-789",
    });

    const body = JSON.parse(String(init?.body));
    expect(body.metadata).toMatchObject({
      language: "ko",
      user_id: "user-123",
      tenant_id: "tenant-456",
      workspace_id: "workspace-789",
      sayknowmind_document_id: "skm-doc-1",
    });
    expect(body.async_processing).toBe(false);
  });
});
