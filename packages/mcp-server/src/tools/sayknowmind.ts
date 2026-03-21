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
import { formatError } from "../errors.js";

const WEB_APP_URL = process.env.SAYKNOWMIND_URL ?? "http://localhost:3000";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "";

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (AUTH_SECRET) {
    h["Authorization"] = `Bearer ${AUTH_SECRET}`;
  }
  return h;
}

/**
 * Validate auth token. Returns true if valid.
 */
function verifyAuthToken(token?: string): boolean {
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
}
