// =============================================================================
// SayknowMind v0.1.0 - Core Type Definitions
// All shared interfaces, types, and enums for the platform
// =============================================================================

// ---------------------------------------------------------------------------
// Enums & Union Types
// ---------------------------------------------------------------------------

export type QueryMode = 'local' | 'global' | 'hybrid' | 'drift' | 'mix' | 'naive';

export type SourceType = 'web' | 'file' | 'text' | 'browser_extension';

export type EntityType = 'person' | 'organization' | 'location' | 'concept' | 'keyword' | 'date' | 'other';

export type NodeType = 'document' | 'entity' | 'category' | 'concept';

export type EdgeType = 'mentions' | 'related_to' | 'cites' | 'belongs_to' | 'similar_to';

export type MessageRole = 'user' | 'assistant' | 'system';

export type ChatMode = 'simple' | 'agentic';

export type AccessConditionType = 'wallet' | 'token' | 'nft' | 'public';

export type PrivacyLevel = 'private' | 'shared';

export type IngestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type Language = 'ko' | 'en' | 'ja' | 'zh';

export type Theme = 'light' | 'dark' | 'auto';

export enum ErrorCode {
  // Auth errors (1000-1099)
  AUTH_INVALID_CREDENTIALS = 1001,
  AUTH_TOKEN_EXPIRED = 1002,
  AUTH_ACCOUNT_LOCKED = 1003,
  AUTH_INSUFFICIENT_PERMISSIONS = 1004,

  // Ingestion errors (2000-2099)
  INGEST_INVALID_URL = 2001,
  INGEST_FETCH_FAILED = 2002,
  INGEST_PARSE_FAILED = 2003,
  INGEST_UNSUPPORTED_FORMAT = 2004,

  // Search errors (3000-3099)
  SEARCH_INVALID_QUERY = 3001,
  SEARCH_TIMEOUT = 3002,
  SEARCH_NO_RESULTS = 3003,

  // Category errors (4000-4099)
  CATEGORY_NOT_FOUND = 4001,
  CATEGORY_DUPLICATE_NAME = 4002,
  CATEGORY_CIRCULAR_REFERENCE = 4003,

  // Agent errors (5000-5099)
  AGENT_EXECUTION_FAILED = 5001,
  AGENT_TIMEOUT = 5002,
  AGENT_RESOURCE_LIMIT = 5003,

  // System errors (9000-9099)
  SYSTEM_DATABASE_ERROR = 9001,
  SYSTEM_NETWORK_ERROR = 9002,
  SYSTEM_INTERNAL_ERROR = 9003,
  SYSTEM_VALIDATION_ERROR = 9004,
}

// ---------------------------------------------------------------------------
// Data Models
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  createdAt: Date;
  lastLogin?: Date;
  failedLoginCount: number;
  lockedUntil?: Date;
  settings: UserSettings;
}

export interface UserSettings {
  language: Language;
  theme: Theme;
  defaultQueryMode: QueryMode;
}

export interface Document {
  id: string;
  userId: string;
  title: string;
  content: string;
  summary: string;
  url?: string;
  sourceType: SourceType;
  metadata: DocumentMetadata;
  privacyLevel: PrivacyLevel;
  createdAt: Date;
  updatedAt: Date;
  indexedAt?: Date;
}

export interface DocumentMetadata {
  author?: string;
  publishedAt?: Date;
  language?: string;
  wordCount: number;
  fileType?: string;
  fileSize?: number;
}

export interface Entity {
  id: string;
  documentId: string;
  name: string;
  type: EntityType;
  confidence: number;
  properties: EntityProperties;
  extractedAt: Date;
}

export interface EntityProperties {
  aliases?: string[];
  description?: string;
  wikidata_id?: string;
  [key: string]: unknown;
}

export interface Category {
  id: string;
  userId: string;
  parentId?: string;
  name: string;
  description?: string;
  color?: string;
  depth: number;
  path: string;
  privacyLevel: PrivacyLevel;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  reason: string;
  confidence: number;
}

export interface CategoryTree {
  category: Category;
  children: CategoryTree[];
  documentCount: number;
}

export interface CategoryGraph {
  nodes: Array<{ id: string; name: string; depth: number; documentCount: number }>;
  edges: Array<{ source: string; target: string; type: 'parent_child' | 'related' }>;
}

export interface Vector {
  id: string;
  documentId: string;
  embedding: number[];
  modelName: string;
  dimension: number;
  createdAt: Date;
}

export interface GraphNode {
  id: string;
  documentId?: string;
  entityId?: string;
  nodeType: NodeType;
  properties: {
    label: string;
    weight?: number;
    [key: string]: unknown;
  };
  createdAt: Date;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: EdgeType;
  weight: number;
  properties: {
    [key: string]: unknown;
  };
  createdAt: Date;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  citations?: Citation[];
  agentSteps?: AgentStep[];
  createdAt: Date;
}

export interface Citation {
  documentId: string;
  title: string;
  url?: string;
  excerpt: string;
  relevanceScore: number;
}

export interface AgentStep {
  stepId: string;
  agentName: string;
  action: string;
  result: string;
  timestamp: string;
}

export interface SharedContent {
  id: string;
  documentId: string;
  userId: string;
  ipfsCid?: string;
  arweaveTxId?: string;
  ceramicStreamId?: string;
  accessConditions: AccessConditions;
  isRevoked: boolean;
  createdAt: Date;
  revokedAt?: Date;
}

export interface AccessConditions {
  type: AccessConditionType;
  addresses?: string[];
  tokenAddress?: string;
  minBalance?: string;
  nftAddress?: string;
}

// ---------------------------------------------------------------------------
// Error Response
// ---------------------------------------------------------------------------

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
  details?: unknown;
  timestamp: string;
  requestId: string;
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
}

export interface SignupResponse {
  userId: string;
  token: string;
  expiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  userId: string;
  token: string;
  expiresAt: string;
}

export interface LogoutRequest {
  token: string;
}

export interface LogoutResponse {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Ingestion API
// ---------------------------------------------------------------------------

export interface IngestUrlRequest {
  url: string;
  categoryId?: string;
  tags?: string[];
}

export interface IngestUrlResponse {
  documentId: string;
  title: string;
  summary: string;
  entities: Entity[];
  suggestedCategories: CategorySuggestion[];
}

export interface IngestFileRequest {
  file: File;
  categoryId?: string;
  tags?: string[];
}

export interface IngestFileResponse {
  documentId: string;
  title: string;
  summary: string;
  entities: Entity[];
  suggestedCategories: CategorySuggestion[];
}

export interface IngestStatusResponse {
  jobId: string;
  status: IngestStatus;
  progress: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Search API
// ---------------------------------------------------------------------------

export interface SearchRequest {
  query: string;
  mode: QueryMode;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
}

export interface SearchFilters {
  categoryIds?: string[];
  dateRange?: { start: string; end: string };
  tags?: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  took: number;
}

export interface SearchResult {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
  citations: Citation[];
  entities: Entity[];
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------

export interface ChatRequest {
  message: string;
  conversationId?: string;
  mode: ChatMode;
  context?: {
    documentIds?: string[];
    categoryIds?: string[];
  };
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  citations: Citation[];
  relatedDocuments: string[];
  agentSteps?: AgentStep[];
}

// ---------------------------------------------------------------------------
// Category API
// ---------------------------------------------------------------------------

export interface GetCategoriesResponse {
  categories: Category[];
  tree: CategoryTree;
  graph: CategoryGraph;
}

export interface CreateCategoryRequest {
  name: string;
  parentId?: string;
  description?: string;
  color?: string;
}

export interface CreateCategoryResponse {
  categoryId: string;
  name: string;
  path: string[];
}

export interface UpdateCategoryRequest {
  name?: string;
  parentId?: string;
  description?: string;
  color?: string;
}

export interface DeleteCategoryResponse {
  success: boolean;
  movedDocuments: number;
}

export interface MergeCategoriesRequest {
  sourceIds: string[];
  targetId: string;
}

export interface MergeCategoriesResponse {
  success: boolean;
  mergedCount: number;
}

// ---------------------------------------------------------------------------
// MCP Server API
// ---------------------------------------------------------------------------

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPSearchParams {
  query: string;
  mode?: string;
  limit?: number;
}

export interface MCPSearchResult {
  documents: Array<{
    id: string;
    title: string;
    content: string;
    url?: string;
    relevance: number;
  }>;
}

export interface MCPIngestParams {
  url?: string;
  content?: string;
  title?: string;
}

export interface MCPIngestResult {
  documentId: string;
  status: 'success' | 'failed';
  message?: string;
}

export interface MCPCategoriesResult {
  categories: Array<{
    id: string;
    name: string;
    path: string[];
  }>;
}
