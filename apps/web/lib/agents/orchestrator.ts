/**
 * Agentic Query Orchestrator
 *
 * Decomposes complex queries into sub-tasks, executes them via AI server
 * tools endpoint, and aggregates results with step tracking.
 */

import { queryEdgeQuake } from "@/lib/edgequake/client";
import type { AgentStep, Citation } from "@/lib/types";

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
const AI_API_KEY = process.env.AI_API_KEY ?? "";
const AI_TIMEOUT = 60_000;

// Resource limits
const MAX_STEPS = 10;
const MAX_STEP_TIME_MS = 30_000;
const STEP_TIMEOUT_MS = 30_000;

export interface AgenticResult {
  answer: string;
  steps: AgentStep[];
  citations: Citation[];
  relatedDocuments: string[];
}

export interface AgenticProgress {
  stepId: string;
  agentName: string;
  action: string;
  status: "running" | "completed" | "failed";
  result?: string;
}

function aiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (AI_API_KEY) h["Authorization"] = `Bearer ${AI_API_KEY}`;
  return h;
}

/**
 * Decompose a complex query into sub-tasks via the AI server.
 */
async function decomposeQuery(
  query: string,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<Array<{ task: string; agent: string }>> {
  const response = await fetch(`${AI_SERVER_URL}/ai/chat`, {
    method: "POST",
    headers: aiHeaders(),
    body: JSON.stringify({
      system: `You are a task decomposition assistant. Break the user's complex query into 2-5 sub-tasks.
Each sub-task should be a focused, actionable step.
Assign each sub-task to an agent type: "search" (knowledge lookup), "analyze" (reasoning/comparison), "summarize" (synthesis).

Return a JSON array of objects: [{"task": "description", "agent": "type"}]
Output ONLY the JSON array.`,
      message: query,
      messages: conversationHistory,
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`AI server returned ${response.status}`);
  }

  const data = await response.json();
  const text = data.response ?? data.message ?? data.content ?? "[]";

  try {
    const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [{ task: query, agent: "search" }];
    return parsed.slice(0, 5).map((t: { task?: string; agent?: string }) => ({
      task: t.task || query,
      agent: t.agent || "search",
    }));
  } catch {
    return [{ task: query, agent: "search" }];
  }
}

/**
 * Execute a single agent step with timeout and error handling.
 */
async function executeStep(
  stepId: string,
  task: string,
  agentName: string,
  userId: string,
  onProgress?: (progress: AgenticProgress) => void,
): Promise<AgentStep> {
  const startTime = new Date().toISOString();

  onProgress?.({
    stepId,
    agentName,
    action: task,
    status: "running",
  });

  try {
    let result: string;
    const stepStart = Date.now();

    switch (agentName) {
      case "search": {
        // Execute knowledge graph search
        const eqResult = await Promise.race([
          queryEdgeQuake({
            query: task,
            mode: "hybrid",
            include_references: true,
            max_results: 5,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Step timeout")), STEP_TIMEOUT_MS),
          ),
        ]);
        result = eqResult.answer || eqResult.sources.map((s) => s.snippet).filter(Boolean).join("\n");
        break;
      }

      case "analyze":
      case "summarize":
      default: {
        // Use AI server for reasoning/synthesis
        const response = await fetch(`${AI_SERVER_URL}/ai/chat`, {
          method: "POST",
          headers: aiHeaders(),
          body: JSON.stringify({
            system: agentName === "analyze"
              ? "You are an analytical assistant. Analyze the given information and provide insights."
              : "You are a summarization assistant. Synthesize the given information concisely.",
            message: task,
            userId,
          }),
          signal: AbortSignal.timeout(MAX_STEP_TIME_MS),
        });
        if (!response.ok) throw new Error(`AI returned ${response.status}`);
        const data = await response.json();
        result = data.response ?? data.message ?? data.content ?? "";
        break;
      }
    }

    // Resource monitoring: log if step took too long
    const elapsed = Date.now() - stepStart;
    if (elapsed > MAX_STEP_TIME_MS * 0.8) {
      console.warn(`[orchestrator] Step ${stepId} took ${elapsed}ms (near limit)`);
    }

    onProgress?.({
      stepId,
      agentName,
      action: task,
      status: "completed",
      result,
    });

    return {
      stepId,
      agentName,
      action: task,
      result,
      timestamp: startTime,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] Step ${stepId} (${agentName}) failed:`, errorMessage);

    onProgress?.({
      stepId,
      agentName,
      action: task,
      status: "failed",
      result: errorMessage,
    });

    // Log agent execution for monitoring
    logAgentExecution(stepId, agentName, task, "failed", errorMessage);

    return {
      stepId,
      agentName,
      action: task,
      result: `Error: ${errorMessage}`,
      timestamp: startTime,
    };
  }
}

/**
 * Log agent execution history for monitoring (task 6.7).
 */
function logAgentExecution(
  stepId: string,
  agentName: string,
  action: string,
  status: string,
  result: string,
) {
  console.log(
    JSON.stringify({
      type: "agent_execution",
      stepId,
      agentName,
      action,
      status,
      result: result.slice(0, 200),
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Execute an agentic query: decompose → execute steps → synthesize answer.
 */
export async function executeAgenticQuery(
  query: string,
  userId: string,
  conversationHistory: Array<{ role: string; content: string }>,
  onProgress?: (progress: AgenticProgress) => void,
): Promise<AgenticResult> {
  const steps: AgentStep[] = [];
  const citations: Citation[] = [];
  let stepCount = 0;

  // Step 1: Decompose query into sub-tasks
  const subtasks = await decomposeQuery(query, conversationHistory);

  // Step 2: Execute each sub-task
  for (const subtask of subtasks) {
    if (stepCount >= MAX_STEPS) {
      console.warn("[orchestrator] Max steps reached, stopping execution");
      break;
    }

    const stepId = `step-${stepCount + 1}`;
    const step = await executeStep(stepId, subtask.task, subtask.agent, userId, onProgress);
    steps.push(step);
    stepCount++;

    // Log successful execution
    logAgentExecution(stepId, subtask.agent, subtask.task, "completed", step.result);
  }

  // Step 3: Synthesize final answer from all step results
  const stepResults = steps
    .filter((s) => !s.result.startsWith("Error:"))
    .map((s, i) => `[Step ${i + 1} - ${s.agentName}]: ${s.result}`)
    .join("\n\n");

  let answer: string;
  if (stepResults) {
    const response = await fetch(`${AI_SERVER_URL}/ai/chat`, {
      method: "POST",
      headers: aiHeaders(),
      body: JSON.stringify({
        system: `You are a knowledge synthesis assistant. Based on the research steps below, provide a comprehensive answer to the user's original question. Be thorough but concise.

Research results:
${stepResults}`,
        message: query,
        userId,
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT),
    });

    if (response.ok) {
      const data = await response.json();
      answer = data.response ?? data.message ?? data.content ?? stepResults;
    } else {
      answer = stepResults;
    }
  } else {
    answer = "I was unable to find relevant information for your query.";
  }

  return {
    answer,
    steps,
    citations,
    relatedDocuments: [],
  };
}
