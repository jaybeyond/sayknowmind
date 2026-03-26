/**
 * UltraRAG Pipeline Executor
 *
 * Executes validated YAML pipelines step-by-step, delegating to
 * EdgeQuake, AI Server, and MCP Server as needed.
 */

import type {
  UltraRAGPipeline, PipelineStep, PipelineExecutionResult, StepResult,
} from "./types";
import { validatePipeline } from "./validator";
import { queryEdgeQuake, indexDocument } from "@/lib/edgequake/client";

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:8082";

export async function executePipeline(
  pipeline: UltraRAGPipeline,
  context: Record<string, unknown> = {},
): Promise<PipelineExecutionResult> {
  const validation = validatePipeline(pipeline);
  if (!validation.valid) {
    return {
      pipelineId: pipeline.name,
      status: "failed",
      steps: [],
      totalDurationMs: 0,
      error: `Validation failed: ${validation.errors.join("; ")}`,
    };
  }

  const start = Date.now();
  const stepResults: StepResult[] = [];
  const stepOutputs = new Map<string, unknown>();

  // Topological execution order (respecting depends_on)
  const executionOrder = resolveExecutionOrder(pipeline.steps);

  for (const step of executionOrder) {
    // Gather dependency outputs
    const depOutputs: Record<string, unknown> = {};
    for (const dep of step.depends_on ?? []) {
      depOutputs[dep] = stepOutputs.get(dep);
    }

    const stepStart = Date.now();
    let result: StepResult;

    try {
      const timeout = step.timeout_ms ?? 60_000;
      const output = await Promise.race([
        executeStep(step, { ...context, ...depOutputs }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Step timed out")), timeout),
        ),
      ]);

      result = {
        stepId: step.id,
        status: "completed",
        output,
        durationMs: Date.now() - stepStart,
      };
      stepOutputs.set(step.id, output);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result = {
        stepId: step.id,
        status: "failed",
        output: null,
        durationMs: Date.now() - stepStart,
        error: errorMsg,
      };

      if (pipeline.on_error === "stop") {
        stepResults.push(result);
        return {
          pipelineId: pipeline.name,
          status: "failed",
          steps: stepResults,
          totalDurationMs: Date.now() - start,
          error: `Step '${step.id}' failed: ${errorMsg}`,
        };
      }
      // "skip" or "retry" — continue
    }

    stepResults.push(result);
  }

  const hasFailures = stepResults.some((r) => r.status === "failed");
  return {
    pipelineId: pipeline.name,
    status: hasFailures ? "partial" : "completed",
    steps: stepResults,
    totalDurationMs: Date.now() - start,
  };
}

async function executeStep(
  step: PipelineStep,
  context: Record<string, unknown>,
): Promise<unknown> {
  switch (step.type) {
    case "crawl":
      throw new Error("Crawl step not supported — use the ingest pipeline directly");

    case "extract":
      return callAiServer("/ai/chat", {
        system: "Extract entities from the following content. Return JSON array.",
        message: String(step.config.content ?? context.content ?? ""),
      });

    case "summarize":
      return callAiServer("/ai/chat", {
        system: "Summarize the following content in 3-5 sentences.",
        message: String(step.config.content ?? context.content ?? ""),
      });

    case "categorize":
      return callAiServer("/ai/chat", {
        system: "Suggest categories for this content. Return JSON array with name and confidence.",
        message: String(step.config.content ?? context.content ?? ""),
      });

    case "embed":
      return indexDocument({
        content: String(step.config.content ?? context.content ?? ""),
        title: String(step.config.title ?? ""),
        document_id: String(step.config.document_id ?? ""),
      });

    case "search":
      return queryEdgeQuake({
        query: String(step.config.query ?? ""),
        mode: (step.config.mode as "hybrid") ?? "hybrid",
        include_references: true,
      });

    case "transform":
      // Pass-through with optional field mapping
      return { ...context, transformed: true, ...step.config };

    case "mcp_skill":
      return callMcpServer(String(step.config.method ?? ""), step.config.params ?? {});

    case "condition": {
      const condField = String(step.config.field ?? "");
      const condValue = context[condField];
      if (condValue) {
        return { matched: true, value: condValue };
      }
      return { matched: false };
    }

    case "parallel": {
      const subSteps = (step.config.steps ?? []) as PipelineStep[];
      const results = await Promise.allSettled(
        subSteps.map((s) => executeStep(s, context)),
      );
      return results.map((r, i) => ({
        stepId: subSteps[i]?.id ?? `parallel_${i}`,
        status: r.status === "fulfilled" ? "completed" : "failed",
        output: r.status === "fulfilled" ? r.value : undefined,
        error: r.status === "rejected" ? String(r.reason) : undefined,
      }));
    }

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

async function callAiServer(path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.AI_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${AI_SERVER_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`AI Server ${path} failed: ${res.status}`);
  return res.json();
}

async function callMcpServer(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(`${MCP_SERVER_URL}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`MCP Server ${method} failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function resolveExecutionOrder(steps: PipelineStep[]): PipelineStep[] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const resolved: PipelineStep[] = [];
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const step = stepMap.get(id);
    if (!step) return;
    for (const dep of step.depends_on ?? []) {
      visit(dep);
    }
    resolved.push(step);
  }

  for (const step of steps) visit(step.id);
  return resolved;
}
