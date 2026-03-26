/**
 * UltraRAG — YAML-based Agentic RAG Pipeline Framework
 *
 * Defines pipeline steps declaratively in YAML.
 */

export interface UltraRAGPipeline {
  name: string;
  version: string;
  description?: string;
  steps: PipelineStep[];
  on_error?: "stop" | "skip" | "retry";
  max_retries?: number;
}

export interface PipelineStep {
  id: string;
  type: StepType;
  config: Record<string, unknown>;
  depends_on?: string[];
  timeout_ms?: number;
  retry?: number;
}

export type StepType =
  | "crawl"           // Web crawl (via ingest pipeline)
  | "extract"         // Entity extraction via AI
  | "summarize"       // Document summarization
  | "categorize"      // Auto-category assignment
  | "embed"           // Vector embedding via EdgeQuake
  | "search"          // RAG search
  | "transform"       // Custom data transformation
  | "mcp_skill"       // MCP Server skill invocation
  | "condition"       // Conditional branching
  | "parallel";       // Parallel execution group

export interface PipelineExecutionResult {
  pipelineId: string;
  status: "completed" | "failed" | "partial";
  steps: StepResult[];
  totalDurationMs: number;
  error?: string;
}

export interface StepResult {
  stepId: string;
  status: "completed" | "failed" | "skipped";
  output: unknown;
  durationMs: number;
  error?: string;
}

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
