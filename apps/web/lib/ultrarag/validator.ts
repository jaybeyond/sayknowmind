/**
 * UltraRAG Pipeline YAML Validator
 *
 * Validates pipeline definitions for correctness before execution.
 */

import type { UltraRAGPipeline, PipelineStep, PipelineValidationResult, StepType } from "./types";

const VALID_STEP_TYPES: StepType[] = [
  "crawl", "extract", "summarize", "categorize", "embed",
  "search", "transform", "mcp_skill", "condition", "parallel",
];

export function validatePipeline(pipeline: unknown): PipelineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!pipeline || typeof pipeline !== "object") {
    return { valid: false, errors: ["Pipeline must be an object"], warnings };
  }

  const p = pipeline as Record<string, unknown>;

  // Required fields
  if (!p.name || typeof p.name !== "string") {
    errors.push("Pipeline 'name' is required and must be a string");
  }
  if (!p.version || typeof p.version !== "string") {
    errors.push("Pipeline 'version' is required and must be a string");
  }
  if (!Array.isArray(p.steps) || p.steps.length === 0) {
    errors.push("Pipeline 'steps' must be a non-empty array");
    return { valid: false, errors, warnings };
  }

  // Validate steps
  const stepIds = new Set<string>();
  for (let i = 0; i < (p.steps as unknown[]).length; i++) {
    const step = (p.steps as unknown[])[i] as Record<string, unknown>;
    const prefix = `steps[${i}]`;

    if (!step.id || typeof step.id !== "string") {
      errors.push(`${prefix}: 'id' is required and must be a string`);
      continue;
    }

    if (stepIds.has(step.id as string)) {
      errors.push(`${prefix}: Duplicate step id '${step.id}'`);
    }
    stepIds.add(step.id as string);

    if (!step.type || !VALID_STEP_TYPES.includes(step.type as StepType)) {
      errors.push(`${prefix}: Invalid step type '${step.type}'. Valid: ${VALID_STEP_TYPES.join(", ")}`);
    }

    if (!step.config || typeof step.config !== "object") {
      errors.push(`${prefix}: 'config' is required and must be an object`);
    }

    // Validate depends_on references
    if (Array.isArray(step.depends_on)) {
      for (const dep of step.depends_on as string[]) {
        if (!stepIds.has(dep)) {
          // Forward reference — check later
          warnings.push(`${prefix}: depends_on '${dep}' — ensure this step exists`);
        }
      }
    }

    // Validate timeout
    if (step.timeout_ms !== undefined && (typeof step.timeout_ms !== "number" || step.timeout_ms <= 0)) {
      errors.push(`${prefix}: 'timeout_ms' must be a positive number`);
    }
  }

  // Check for circular dependencies
  const circularCheck = detectCycles(p.steps as PipelineStep[]);
  if (circularCheck) {
    errors.push(`Circular dependency detected: ${circularCheck}`);
  }

  // Validate on_error
  if (p.on_error && !["stop", "skip", "retry"].includes(p.on_error as string)) {
    errors.push("'on_error' must be one of: stop, skip, retry");
  }

  return { valid: errors.length === 0, errors, warnings };
}

function detectCycles(steps: PipelineStep[]): string | null {
  const graph = new Map<string, string[]>();
  for (const step of steps) {
    graph.set(step.id, step.depends_on ?? []);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): string | null {
    if (inStack.has(node)) return node;
    if (visited.has(node)) return null;
    visited.add(node);
    inStack.add(node);
    for (const dep of graph.get(node) ?? []) {
      const cycle = dfs(dep);
      if (cycle) return `${dep} → ${node}`;
    }
    inStack.delete(node);
    return null;
  }

  for (const step of steps) {
    const cycle = dfs(step.id);
    if (cycle) return cycle;
  }
  return null;
}
