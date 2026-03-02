// Span type definitions
export enum SpanType {
  AI_CALL = 'AI_CALL',
  SEARCH = 'SEARCH',
  OCR = 'OCR',
  MEMORY_ACCESS = 'MEMORY_ACCESS',
  FEEDBACK = 'FEEDBACK',
}

// Span status definitions
export enum SpanStatus {
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// Span interface
export interface Span {
  id: string;
  type: SpanType;
  status: SpanStatus;

  // Context
  userId?: string;
  sessionId?: string;
  parentSpanId?: string;

  // Timing
  startTime: string;
  endTime?: string;
  latencyMs?: number;

  // AI-related
  modelRequested?: string;
  modelUsed?: string;
  tokensUsed?: number;
  fallbackUsed?: boolean;

  // Result
  success?: boolean;
  errorMessage?: string;
  responseLength?: number;

  // Metadata
  metadata: Record<string, any>;

  // Feedback link
  feedbackId?: string;
}

// Span creation DTO
export interface CreateSpanDto {
  type: SpanType;
  userId?: string;
  sessionId?: string;
  parentSpanId?: string;
  modelRequested?: string;
  metadata?: Record<string, any>;
}

// Span update DTO
export interface UpdateSpanDto {
  status?: SpanStatus;
  endTime?: string;
  latencyMs?: number;
  modelUsed?: string;
  tokensUsed?: number;
  fallbackUsed?: boolean;
  success?: boolean;
  errorMessage?: string;
  responseLength?: number;
  feedbackId?: string;
}

// Span filter interface
export interface SpanFilter {
  userId?: string;
  sessionId?: string;
  type?: SpanType;
  startTime?: Date;
  endTime?: Date;
  success?: boolean;
  limit?: number;
}

// Span start options
export interface StartSpanOptions {
  type: SpanType;
  userId?: string;
  sessionId?: string;
  parentSpanId?: string;
  metadata?: Record<string, any>;
}

// Span result
export interface SpanResult {
  success: boolean;
  modelUsed?: string;
  tokensUsed?: number;
  latencyMs: number;
  fallbackUsed?: boolean;
  responseLength?: number;
}

// ==================== Adapter Service DTOs ====================

/**
 * Query features interface.
 * Represents characteristics of a query extracted from a Span.
 */
export interface QueryFeatures {
  hasCode: boolean;       // Whether code is included
  hasQuestion: boolean;   // Whether a question is included
  language: string;       // Detected language (ko, en, ja, etc.)
  length: number;         // Query length (character count)
  keywords: string[];     // Extracted keywords
}

/**
 * Learning record interface.
 * Result of converting a Span into a learnable format.
 * 
 * Requirements: 3.1
 */
export interface LearningRecord {
  queryType: string;        // Query classification (code, search, general, etc.)
  modelUsed: string;        // Model used
  latencyMs: number;        // Latency (ms)
  tokensUsed: number;       // Tokens used
  success: boolean;         // Whether successful
  feedbackScore?: number;   // Feedback score (when linked)
  features: QueryFeatures;  // Query features
}

/**
 * Query type enum
 */
export enum QueryType {
  CODE = 'code',           // Code-related query
  SEARCH = 'search',       // Search query
  GENERAL = 'general',     // General conversation
  TRANSLATION = 'translation', // Translation request
  ANALYSIS = 'analysis',   // Analysis request
  UNKNOWN = 'unknown',     // Unclassifiable
}
