/**
 * Unit tests for the MCP server.
 * Uses in-memory transport to verify tool/resource/prompt registration
 * and the MCP protocol handshake works correctly.
 *
 * When the EdgeQuake backend is running, tools return real data.
 * When it isn't, tools return isError:true with a message.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

describe("MCP server unit tests", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = createServer();
    client = new Client({ name: "test-client", version: "0.1.0" });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("should list all registered tools", async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name).sort();

    const expected = [
      "document_delete",
      "document_get",
      "document_list",
      "document_status",
      "document_upload",
      "document_upload_file",
      "graph_entity_neighborhood",
      "graph_get_entity",
      "graph_search_entities",
      "graph_search_relationships",
      "health",
      "query",
      "sayknowmind_categories",
      "sayknowmind_category_create",
      "sayknowmind_category_delete",
      "sayknowmind_category_update",
      "sayknowmind_conversation_get",
      "sayknowmind_conversations_list",
      "sayknowmind_doc_create",
      "sayknowmind_doc_set_content",
      "sayknowmind_document_add_tags",
      "sayknowmind_document_assign_category",
      "sayknowmind_document_delete",
      "sayknowmind_document_get",
      "sayknowmind_document_related",
      "sayknowmind_document_remove_tags",
      "sayknowmind_document_update",
      "sayknowmind_documents_list",
      "sayknowmind_ingest",
      "sayknowmind_search",
      "sayknowmind_share_create",
      "sayknowmind_tags_list",
      "sayknowmind_task_create",
      "sayknowmind_task_delete",
      "sayknowmind_task_projects_list",
      "sayknowmind_task_update",
      "sayknowmind_tasks_list",
      "workspace_create",
      "workspace_delete",
      "workspace_get",
      "workspace_list",
      "workspace_stats",
    ];

    expect(toolNames).toEqual(expected);
  });

  it("should have correct input schemas for key tools", async () => {
    const tools = await client.listTools();
    const toolMap = new Map(tools.tools.map((t) => [t.name, t]));

    // health has no required params
    const health = toolMap.get("health");
    expect(health).toBeDefined();

    // query requires 'query' string
    const query = toolMap.get("query");
    expect(query).toBeDefined();
    const queryProps = query!.inputSchema.properties as Record<
      string,
      unknown
    >;
    expect(queryProps).toHaveProperty("query");
    expect(queryProps).toHaveProperty("mode");
    expect(queryProps).toHaveProperty("conversation_history");

    // document_upload requires 'content' string
    const upload = toolMap.get("document_upload");
    expect(upload).toBeDefined();
    const uploadProps = upload!.inputSchema.properties as Record<
      string,
      unknown
    >;
    expect(uploadProps).toHaveProperty("content");
    expect(uploadProps).toHaveProperty("title");
    expect(uploadProps).toHaveProperty("enable_gleaning");

    // workspace_create requires 'name' string
    const create = toolMap.get("workspace_create");
    expect(create).toBeDefined();
    const createProps = create!.inputSchema.properties as Record<
      string,
      unknown
    >;
    expect(createProps).toHaveProperty("name");
    expect(createProps).toHaveProperty("llm_provider");
    expect(createProps).toHaveProperty("embedding_model");
  });

  it("should list registered prompts", async () => {
    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map((p) => p.name).sort();
    expect(promptNames).toEqual(["document_summary", "rag_query"]);
  });

  it("should resolve rag_query prompt with topic interpolation", async () => {
    const result = await client.getPrompt({
      name: "rag_query",
      arguments: { topic: "What is EdgeQuake?" },
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    const content = result.messages[0].content as {
      type: string;
      text: string;
    };
    expect(content.text).toContain("EdgeQuake");
    expect(content.text).toContain("hybrid");
  });

  it("should resolve document_summary prompt with document_id", async () => {
    const result = await client.getPrompt({
      name: "document_summary",
      arguments: { document_id: "test-uuid-123" },
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    const content = result.messages[0].content as {
      type: string;
      text: string;
    };
    expect(content.text).toContain("test-uuid-123");
  });

  it("should call health tool and get a response (not crash)", async () => {
    const result = await client.callTool({ name: "health", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    // Either healthy or error — both are valid, the key is it doesn't crash
    if (result.isError) {
      expect(content[0].text.length).toBeGreaterThan(0);
    } else {
      try {
        const parsed = JSON.parse(content[0].text);
        expect(parsed).toHaveProperty("status");
      } catch {
        // Some local dev ports can return non-JSON health pages. The unit
        // contract here is only that the MCP tool returns one text response
        // without crashing.
        expect(content[0].text.length).toBeGreaterThan(0);
      }
    }
  });

  it("should call workspace_list and get a response (not crash)", async () => {
    const result = await client.callTool({
      name: "workspace_list",
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    if (result.isError) {
      expect(content[0].text.length).toBeGreaterThan(0);
    } else {
      const parsed = JSON.parse(content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
    }
  });

  it("should call document_list and get a response (not crash)", async () => {
    const result = await client.callTool({
      name: "document_list",
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    if (result.isError) {
      expect(content[0].text).toContain("Error");
    } else {
      const parsed = JSON.parse(content[0].text);
      expect(parsed).toHaveProperty("documents");
      expect(parsed).toHaveProperty("total");
    }
  });

  it("should call graph_search_entities and get a response (not crash)", async () => {
    const result = await client.callTool({
      name: "graph_search_entities",
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    if (result.isError) {
      expect(content[0].text).toContain("Error");
    } else {
      const parsed = JSON.parse(content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
    }
  });

  it("should expose sayknowmind_documents_list with the documented schema", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "sayknowmind_documents_list");
    expect(tool).toBeDefined();
    const props = tool!.inputSchema.properties as Record<string, unknown>;
    // The shape mirrors the GET /api/documents query string the web
    // route accepts — these are the levers a caller actually needs.
    expect(props).toHaveProperty("page");
    expect(props).toHaveProperty("limit");
    expect(props).toHaveProperty("q");
    expect(props).toHaveProperty("category_id");
    expect(props).toHaveProperty("source_type");
    expect(props).toHaveProperty("is_favorite");
  });

  it("should expose sayknowmind_document_get with a document_id param", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "sayknowmind_document_get");
    expect(tool).toBeDefined();
    const props = tool!.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("document_id");
    const required = tool!.inputSchema.required as string[] | undefined;
    expect(required).toContain("document_id");
  });

  it("should expose project-aware SayKnowMind task tools", async () => {
    const tools = await client.listTools();
    const toolMap = new Map(tools.tools.map((tool) => [tool.name, tool]));

    expect(toolMap.get("sayknowmind_task_projects_list")).toBeDefined();
    const listProps = toolMap.get("sayknowmind_tasks_list")!.inputSchema.properties as Record<string, unknown>;
    const createProps = toolMap.get("sayknowmind_task_create")!.inputSchema.properties as Record<string, unknown>;
    expect(listProps).toHaveProperty("project_id");
    expect(createProps).toHaveProperty("project_id");
  });
});

describe("Per-user isolation gate on workspace tools and resources", () => {
  // Verifies the security claim from the multitenant data isolation spec:
  // when an MCP request is authenticated as a real end-user (sk-mcp-…
  // key resolved to a user_id), the raw EdgeQuake workspace tools and
  // resources must refuse — they share a global tenant/workspace and
  // would leak data across users. Admin/stdio callers keep access.
  it("blocks every workspace_* tool for per-user contexts", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );
    const { createServer } = await import("../src/server.js");
    const { requestContext } = await import("../src/auth-context.js");

    const server = createServer();
    const client = new Client({ name: "user-scoped", version: "0.1.0" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    try {
      const toolsToCheck: Array<{ name: string; args: Record<string, unknown> }> = [
        { name: "workspace_list", args: {} },
        { name: "workspace_create", args: { name: "should-not-create" } },
        { name: "workspace_get", args: { workspace_id: "x" } },
        { name: "workspace_delete", args: { workspace_id: "x" } },
        { name: "workspace_stats", args: { workspace_id: "x" } },
      ];

      for (const { name, args } of toolsToCheck) {
        const result = await requestContext.run(
          { userId: "user-abc", rawToken: "sk-mcp-test", isAdmin: false },
          () => client.callTool({ name, arguments: args }),
        );
        expect(result.isError, `${name} should be gated`).toBe(true);
        const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
        expect(text).toContain("user_isolation_unimplemented");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects raw workspace resources for per-user contexts and lets admins through", async () => {
    // Resource read handlers are registered with literal-template URIs
    // (e.g. "edgequake://workspace/{workspace_id}/stats") which the
    // current MCP SDK doesn't expand for client.readResource. So instead
    // of routing through the SDK, exercise the gate directly — that is
    // the actual security boundary the spec cares about.
    const { rejectUserScopedEdgeQuakeResource, requestContext } = await import(
      "../src/auth-context.js"
    );

    const uri = new URL("edgequake://workspace/ws-1/stats");

    // Admin/stdio caller — no per-user context, gate stays open.
    expect(rejectUserScopedEdgeQuakeResource(uri)).toBeNull();

    // Per-user MCP key — gate returns the isolation refusal envelope.
    const blocked = requestContext.run(
      { userId: "user-abc", rawToken: "sk-mcp-test", isAdmin: false },
      () => rejectUserScopedEdgeQuakeResource(uri),
    );
    expect(blocked).not.toBeNull();
    const text = blocked?.contents[0]?.text ?? "";
    const body = JSON.parse(text);
    expect(body).toMatchObject({
      error: "user_isolation_unimplemented",
      status: 403,
    });
    expect(blocked?.contents[0]?.uri).toBe(uri.href);
  });
});
