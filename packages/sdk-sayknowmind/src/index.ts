/**
 * @sayknowmind/sdk - Official TypeScript SDK for SayknowMind
 *
 * Usage:
 *   import { SayknowMindClient } from "@sayknowmind/sdk";
 *   const client = new SayknowMindClient({ baseUrl: "http://localhost:3000", token: "..." });
 *   const results = await client.search("AI research");
 */

export { SayknowMindClient } from "./client.js";
export type {
  SayknowMindConfig,
  SearchParams,
  SearchResult,
  SearchResponse,
  IngestUrlParams,
  IngestTextParams,
  IngestResponse,
  ChatParams,
  ChatResponse,
  ChatStreamEvent,
  Category,
  CreateCategoryParams,
  SayknowMindError,
} from "./types.js";
