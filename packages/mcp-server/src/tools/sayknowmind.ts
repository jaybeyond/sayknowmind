/**
 * SayknowMind-specific MCP tools
 *
 * Implements:
 * - sayknowmind.search: Search knowledge base
 * - sayknowmind.ingest: Ingest content
 * - sayknowmind.categories: List categories
 *
 * These tools proxy to the SayknowMind web app API.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRequestContext } from "../auth-context.js";
import { formatError } from "../errors.js";

const WEB_APP_URL = process.env.SAYKNOWMIND_URL ?? "http://localhost:5400";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "";

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const context = getRequestContext();
  if (context?.rawToken) {
    h["Authorization"] = `Bearer ${context.rawToken}`;
  } else if (AUTH_SECRET) {
    h["Authorization"] = `Bearer ${AUTH_SECRET}`;
  }
  return h;
}

/**
 * Validate auth token. Returns true if valid.
 */
function verifyAuthToken(token?: string): boolean {
  if (getRequestContext()?.rawToken) return true;
  if (!AUTH_SECRET) return true; // No auth configured
  return token === AUTH_SECRET;
}

export function registerSayknowmindTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // sayknowmind.search — Search the knowledge base
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_search",
    "Search the SayknowMind personal knowledge base. Returns documents with citations and relevance scores.",
    {
      query: z.string().describe("Natural language search query"),
      mode: z
        .enum(["naive", "local", "global", "hybrid", "mix"])
        .optional()
        .describe("Search mode (default: hybrid)"),
      limit: z.number().optional().describe("Max results to return (default: 10)"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(`${WEB_APP_URL}/api/search`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            query: params.query,
            mode: params.mode ?? "hybrid",
            limit: params.limit ?? 10,
          }),
        });

        if (!response.ok) {
          throw new Error(`Search API returned ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.ingest — Ingest content into the knowledge base
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_ingest",
    "Add content to the SayknowMind knowledge base. Supports URLs and text content.",
    {
      url: z.string().optional().describe("URL to ingest"),
      content: z.string().optional().describe("Text content to ingest"),
      title: z.string().optional().describe("Document title"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        let response: Response;

        if (params.url) {
          response = await fetch(`${WEB_APP_URL}/api/ingest/url`, {
            method: "POST",
            headers: apiHeaders(),
            body: JSON.stringify({ url: params.url }),
          });
        } else if (params.content) {
          response = await fetch(`${WEB_APP_URL}/api/ingest/text`, {
            method: "POST",
            headers: apiHeaders(),
            body: JSON.stringify({
              content: params.content,
              title: params.title ?? "Untitled",
            }),
          });
        } else {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Either url or content is required" }) }],
            isError: true,
          };
        }

        if (!response.ok) {
          throw new Error(`Ingest API returned ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.documents_list — List the caller's documents (own + shared)
  //
  // Thin proxy over GET /api/documents. The web route already applies
  // visibilityClause("d", 1) so the caller only ever sees their own rows
  // plus anything marked privacy_level='shared' — we just forward the
  // Bearer token and the pagination/filter params.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_documents_list",
    "List documents the calling user can see (their own + shared) in the SayknowMind knowledge base. Supports pagination, full-text search, and category/source/favorite filters.",
    {
      page: z.number().int().min(1).optional().describe("1-indexed page (default: 1)"),
      limit: z.number().int().min(1).max(100).optional().describe("Items per page, 1..100 (default: 50)"),
      q: z.string().optional().describe("Substring match on title, summary, and URL"),
      category_id: z.string().optional().describe("Filter by category UUID"),
      source_type: z.string().optional().describe("Filter by source_type (e.g. 'url', 'file', 'text')"),
      is_favorite: z.boolean().optional().describe("Only favorites when true"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const query = new URLSearchParams();
        if (params.page !== undefined) query.set("page", String(params.page));
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.q) query.set("q", params.q);
        if (params.category_id) query.set("categoryId", params.category_id);
        if (params.source_type) query.set("sourceType", params.source_type);
        if (params.is_favorite !== undefined) query.set("isFavorite", String(params.is_favorite));

        const qs = query.toString();
        const url = `${WEB_APP_URL}/api/documents${qs ? `?${qs}` : ""}`;
        const response = await fetch(url, { method: "GET", headers: apiHeaders() });

        if (!response.ok) {
          throw new Error(`Documents API returned ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.document_get — Fetch a single document by id
  //
  // Thin proxy over GET /api/documents/[id]. That route enforces
  // visibilityClause("d", 2) on read, so a per-user MCP key can only
  // retrieve documents the caller owns or that are shared.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_document_get",
    "Fetch a single document by id from the SayknowMind knowledge base. Returns 404 if the document is not visible to the calling user (own + shared only).",
    {
      document_id: z.string().describe("Document UUID"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(
          `${WEB_APP_URL}/api/documents/${encodeURIComponent(params.document_id)}`,
          { method: "GET", headers: apiHeaders() },
        );

        if (response.status === 404) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "not_found", document_id: params.document_id }),
              },
            ],
            isError: true,
          };
        }

        if (!response.ok) {
          throw new Error(`Document API returned ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.categories — List knowledge categories
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_categories",
    "List all categories in the SayknowMind knowledge base.",
    {
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(`${WEB_APP_URL}/api/categories`, {
          method: "GET",
          headers: apiHeaders(),
        });

        if (!response.ok) {
          throw new Error(`Categories API returned ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.document_update — Edit a document the caller owns
  //
  // PATCH /api/documents/[id]. The web route enforces user_id = me on
  // write, so a per-user MCP key can only modify the caller's own docs.
  // metadata is JSON-merged (jsonb || patch), so passing { foo: 1 } adds
  // foo without dropping other keys. Supports the same field set as the
  // UI: title, summary, privacy, free-form metadata, and category move.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_document_update",
    "Update a SayknowMind document you own — title, summary, privacy level, free-form metadata, and/or category assignment. metadata is merged into the existing JSON, not replaced. Shared documents you don't own cannot be edited.",
    {
      document_id: z.string().describe("Document UUID to update"),
      title: z.string().optional().describe("New title"),
      summary: z.string().optional().describe("New summary"),
      privacy_level: z
        .enum(["private", "shared"])
        .optional()
        .describe("'private' (only you) or 'shared' (visible to all signed-in users)"),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe("Partial metadata patch — merged into existing metadata jsonb"),
      category_id: z
        .string()
        .nullable()
        .optional()
        .describe("Collection UUID to assign; null to clear; omit to leave unchanged"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (params.title !== undefined) body.title = params.title;
        if (params.summary !== undefined) body.summary = params.summary;
        if (params.privacy_level !== undefined) body.privacyLevel = params.privacy_level;
        if (params.metadata !== undefined) body.metadata = params.metadata;
        if (params.category_id !== undefined) body.categoryId = params.category_id;

        const response = await fetch(
          `${WEB_APP_URL}/api/documents/${encodeURIComponent(params.document_id)}`,
          { method: "PATCH", headers: apiHeaders(), body: JSON.stringify(body) },
        );

        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", document_id: params.document_id }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Document API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.document_delete — Remove a document the caller owns
  //
  // DELETE /api/documents/[id]. Cascade rules in the schema clean up
  // document_categories, tags, chunks, etc. Cannot delete documents owned
  // by another user — even shared ones — by design.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_document_delete",
    "Delete a SayknowMind document you own. Cascades the document's chunks, tag links, and category links. Cannot delete documents owned by other users even when they are shared.",
    {
      document_id: z.string().describe("Document UUID to delete"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(
          `${WEB_APP_URL}/api/documents/${encodeURIComponent(params.document_id)}`,
          { method: "DELETE", headers: apiHeaders() },
        );

        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", document_id: params.document_id }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Document API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const result = await response.json().catch(() => ({ success: true }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.tags_list — Every tag the caller owns
  //
  // GET /api/tags. Tags are per-user; resolveTag() fuzzy-matches when an
  // agent assigns a near-duplicate, so the canonical list returned here
  // is the authoritative vocabulary for that user.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_tags_list",
    "List every tag the calling user has used in SayknowMind. Tags are per-user and unique by canonical (lowercased) name.",
    {
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(`${WEB_APP_URL}/api/tags`, {
          method: "GET",
          headers: apiHeaders(),
        });
        if (!response.ok) {
          throw new Error(`Tags API returned ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.document_add_tags — Append tags to a document
  //
  // POST /api/documents/[id]/tags. Accumulative: existing tags stay,
  // new ones are added. resolveTag() handles dedup + fuzzy match so an
  // agent passing "ai-agent" when the user already has "ai agent" links
  // to the existing tag instead of creating a near-duplicate.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_document_add_tags",
    "Add tags to a document you own. Existing tags on the doc are kept; new ones are added. Names are fuzzy-matched against the user's existing tags to avoid near-duplicates.",
    {
      document_id: z.string().describe("Document UUID"),
      tags: z.array(z.string()).min(1).describe("Tag names to add"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(
          `${WEB_APP_URL}/api/documents/${encodeURIComponent(params.document_id)}/tags`,
          {
            method: "POST",
            headers: apiHeaders(),
            body: JSON.stringify({ tags: params.tags }),
          },
        );
        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Tags API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }
        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.document_remove_tags — Detach specific tags or clear all
  //
  // DELETE /api/documents/[id]/tags with { tags?: [...] } in the body.
  // Omit tags → wipe all of the doc's tags. Pass tag names → only those
  // are removed.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_document_remove_tags",
    "Remove tags from a document you own. Pass a list of tag names to remove only those; pass an empty list or omit the parameter to clear every tag from the document.",
    {
      document_id: z.string().describe("Document UUID"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Specific tag names to remove. Omit or pass [] to clear all tags."),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(
          `${WEB_APP_URL}/api/documents/${encodeURIComponent(params.document_id)}/tags`,
          {
            method: "DELETE",
            headers: apiHeaders(),
            body: JSON.stringify({ tags: params.tags ?? [] }),
          },
        );
        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Tags API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }
        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.document_assign_category — Move a document into a collection
  //
  // Wraps PATCH /api/documents/[id] with just the categoryId field. The
  // web route replaces any prior category links inside one transaction,
  // so this is effectively "set the document's collection to X" (or to
  // none when category_id is null). A separate tool — instead of leaning
  // on the generic document_update — gives agents a clearer name for
  // the action they're trying to take.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_document_assign_category",
    "Assign a document you own to a collection, or detach it. Replaces any existing collection assignment for that document (single-collection semantics, same as the web UI).",
    {
      document_id: z.string().describe("Document UUID to assign"),
      category_id: z
        .string()
        .nullable()
        .describe("Target collection UUID; pass null to detach the document from any collection"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(
          `${WEB_APP_URL}/api/documents/${encodeURIComponent(params.document_id)}`,
          {
            method: "PATCH",
            headers: apiHeaders(),
            body: JSON.stringify({ categoryId: params.category_id }),
          },
        );

        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Document API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.document_related — Graph-based neighbors of a document
  //
  // GET /api/documents/[id]/related. The route honors the own+shared
  // visibility rule both for the source document and for the relations,
  // so an agent can't probe into another user's graph through a shared
  // edge.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_document_related",
    "Fetch documents related to a given document via the knowledge graph (own + shared only). Useful for surfacing follow-up reading or threading a topic an agent is reasoning about.",
    {
      document_id: z.string().describe("Source document UUID"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }
        const response = await fetch(
          `${WEB_APP_URL}/api/documents/${encodeURIComponent(params.document_id)}/related`,
          { method: "GET", headers: apiHeaders() },
        );
        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          throw new Error(`Document API returned ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.conversations_list — Past chat sessions
  //
  // GET /api/conversations. Returns the caller's last 50 conversations
  // (already user-scoped at the DB layer with user_id = me).
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_conversations_list",
    "List the calling user's recent chat conversations in SayknowMind (most recent first, capped at 50). Use sayknowmind_conversation_get to fetch the messages.",
    {
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }
        const response = await fetch(`${WEB_APP_URL}/api/conversations`, {
          method: "GET",
          headers: apiHeaders(),
        });
        if (!response.ok) {
          throw new Error(`Conversations API returned ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.conversation_get — Messages of one conversation
  //
  // GET /api/conversations/[id]/messages. The route enforces ownership;
  // a per-user MCP key can't read another user's chat history.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_conversation_get",
    "Fetch the full message history of one of the calling user's conversations. Returns 404 if the conversation belongs to another user.",
    {
      conversation_id: z.string().describe("Conversation UUID"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }
        const response = await fetch(
          `${WEB_APP_URL}/api/conversations/${encodeURIComponent(params.conversation_id)}/messages`,
          { method: "GET", headers: apiHeaders() },
        );
        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          throw new Error(`Conversations API returned ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.category_create — Create or fetch a collection
  //
  // Maps to POST /api/categories. The web's createCategory() is idempotent
  // on (user_id, name, parent_id): a duplicate request returns the existing
  // row instead of erroring, which is the right semantics for an agent that
  // might re-run a "make sure this collection exists" step.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_category_create",
    "Create a SayknowMind collection (category), or return the existing one if a collection with the same name already exists under the same parent. Idempotent.",
    {
      name: z.string().describe("Collection name"),
      parent_id: z.string().optional().describe("Parent collection UUID for nesting"),
      description: z.string().optional().describe("Optional description"),
      color: z.string().optional().describe("Optional color hex (e.g. #4f46e5)"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(`${WEB_APP_URL}/api/categories`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            name: params.name,
            parentId: params.parent_id,
            description: params.description,
            color: params.color,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Categories API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.category_update — Rename/recolor/move a collection
  //
  // PUT /api/categories/[id]. Web route enforces user_id = me; circular
  // reference detection is in the underlying updateCategory() helper.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_category_update",
    "Rename, recolor, or re-parent a SayknowMind collection. Only the calling user's collections can be modified.",
    {
      category_id: z.string().describe("Collection UUID to update"),
      name: z.string().optional().describe("New name"),
      parent_id: z.string().optional().describe("New parent UUID (or empty string to detach)"),
      description: z.string().optional().describe("New description"),
      color: z.string().optional().describe("New color hex"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {};
        if (params.name !== undefined) body.name = params.name;
        if (params.parent_id !== undefined) body.parentId = params.parent_id;
        if (params.description !== undefined) body.description = params.description;
        if (params.color !== undefined) body.color = params.color;

        const response = await fetch(
          `${WEB_APP_URL}/api/categories/${encodeURIComponent(params.category_id)}`,
          { method: "PUT", headers: apiHeaders(), body: JSON.stringify(body) },
        );

        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", category_id: params.category_id }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Categories API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const result = await response.json();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // sayknowmind.category_delete — Remove a collection
  //
  // DELETE /api/categories/[id]. Cascades the document_categories rows;
  // does not delete the documents themselves.
  // ---------------------------------------------------------------------------
  server.tool(
    "sayknowmind_category_delete",
    "Delete a SayknowMind collection. Documents previously linked to it are unlinked but not deleted. Only the calling user's collections can be removed.",
    {
      category_id: z.string().describe("Collection UUID to delete"),
      auth_token: z.string().optional().describe("Authentication token"),
    },
    async (params) => {
      try {
        if (!verifyAuthToken(params.auth_token)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid auth token" }) }],
            isError: true,
          };
        }

        const response = await fetch(
          `${WEB_APP_URL}/api/categories/${encodeURIComponent(params.category_id)}`,
          { method: "DELETE", headers: apiHeaders() },
        );

        if (response.status === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", category_id: params.category_id }) }],
            isError: true,
          };
        }
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Categories API returned ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const result = await response.json().catch(() => ({ success: true }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
