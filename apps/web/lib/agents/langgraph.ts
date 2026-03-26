/**
 * LangGraph-style Stateful Multi-Agent Orchestrator
 *
 * Manages complex query decomposition into sub-tasks, assigns them to
 * appropriate agents via AI Server, and aggregates results.
 */

export interface AgentNode {
  id: string;
  name: string;
  type: "search" | "summarize" | "extract" | "categorize" | "crawl" | "reason";
  endpoint?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  condition?: (state: WorkflowState) => boolean;
}

export interface WorkflowState {
  query: string;
  subTasks: SubTask[];
  results: Map<string, unknown>;
  currentNode: string;
  history: StepRecord[];
  error?: string;
}

export interface SubTask {
  id: string;
  description: string;
  assignedAgent: string;
  status: "pending" | "running" | "completed" | "failed";
  input: unknown;
  output?: unknown;
}

export interface StepRecord {
  nodeId: string;
  agentName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  timestamp: string;
}

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";

// Default agent registry
const DEFAULT_AGENTS: AgentNode[] = [
  { id: "search", name: "SearchAgent", type: "search" },
  { id: "summarize", name: "SummaryAgent", type: "summarize" },
  { id: "extract", name: "EntityAgent", type: "extract" },
  { id: "categorize", name: "CategoryAgent", type: "categorize" },
  { id: "crawl", name: "CrawlAgent", type: "crawl" },
  { id: "reason", name: "ReasoningAgent", type: "reason" },
];

export class LangGraphOrchestrator {
  private agents: Map<string, AgentNode>;
  private edges: GraphEdge[] = [];

  constructor(agents?: AgentNode[]) {
    this.agents = new Map((agents ?? DEFAULT_AGENTS).map((a) => [a.id, a]));
  }

  addEdge(from: string, to: string, condition?: (state: WorkflowState) => boolean): void {
    this.edges.push({ from, to, condition });
  }

  /**
   * Decompose a complex query into sub-tasks using AI.
   */
  async decomposeQuery(query: string): Promise<SubTask[]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = process.env.AI_API_KEY;
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    try {
      const res = await fetch(`${AI_SERVER_URL}/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          system: `You are a task decomposition agent. Break the user query into 1-5 sub-tasks.
Each sub-task should be assigned to one of these agents: search, summarize, extract, categorize, crawl, reason.
Return a JSON array of objects with: id (string), description (string), assignedAgent (string), input (object with "query" field).
Output ONLY the JSON array.`,
          message: query,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) throw new Error(`AI server returned ${res.status}`);
      const data = await res.json();
      const text = data.response ?? data.message ?? data.content ?? "";
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        return [{ id: "task_1", description: query, assignedAgent: "search", status: "pending", input: { query } }];
      }

      return parsed.map((t: Record<string, unknown>, i: number) => ({
        id: String(t.id ?? `task_${i + 1}`),
        description: String(t.description ?? query),
        assignedAgent: String(t.assignedAgent ?? "search"),
        status: "pending" as const,
        input: t.input ?? { query },
      }));
    } catch {
      // Fallback: single search task
      return [{ id: "task_1", description: query, assignedAgent: "search", status: "pending", input: { query } }];
    }
  }

  /**
   * Execute a full workflow for a complex query.
   */
  async execute(query: string): Promise<{
    state: WorkflowState;
    finalAnswer: string;
  }> {
    const subTasks = await this.decomposeQuery(query);
    const state: WorkflowState = {
      query,
      subTasks,
      results: new Map(),
      currentNode: "start",
      history: [],
    };

    // Execute sub-tasks (parallel where possible)
    const taskPromises = subTasks.map((task) => this.executeSubTask(task, state));
    const results = await Promise.allSettled(taskPromises);

    for (let i = 0; i < results.length; i++) {
      const task = subTasks[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        task.status = "completed";
        task.output = result.value;
        state.results.set(task.id, result.value);
      } else {
        task.status = "failed";
        task.output = { error: result.reason?.message ?? "Unknown error" };
      }
    }

    // Synthesize final answer from all results
    const finalAnswer = await this.synthesize(query, state);

    return { state, finalAnswer };
  }

  private async executeSubTask(task: SubTask, state: WorkflowState): Promise<unknown> {
    const start = Date.now();
    task.status = "running";

    const agent = this.agents.get(task.assignedAgent);
    if (!agent) throw new Error(`Unknown agent: ${task.assignedAgent}`);

    let output: unknown;

    try {
      output = await this.callAiAgent(agent, task);
    } catch (err) {
      // Log and re-throw for the orchestrator to handle
      const record: StepRecord = {
        nodeId: agent.id,
        agentName: agent.name,
        input: task.input,
        output: { error: err instanceof Error ? err.message : String(err) },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
      state.history.push(record);
      throw err;
    }

    const record: StepRecord = {
      nodeId: agent.id,
      agentName: agent.name,
      input: task.input,
      output,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
    state.history.push(record);

    return output;
  }

  private async callAiAgent(agent: AgentNode, task: SubTask): Promise<unknown> {
    const input = task.input as Record<string, unknown>;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = process.env.AI_API_KEY;
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const systemPrompts: Record<string, string> = {
      search: "You are a search agent. Find relevant information for the query.",
      summarize: "You are a summarization agent. Provide a concise summary.",
      extract: "You are an entity extraction agent. Extract key entities as JSON.",
      categorize: "You are a categorization agent. Suggest categories.",
      reason: "You are a reasoning agent. Analyze and provide logical conclusions.",
    };

    const res = await fetch(`${AI_SERVER_URL}/ai/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        system: systemPrompts[agent.type] ?? "You are a helpful assistant.",
        message: JSON.stringify(input),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`AI server returned ${res.status}`);
    return res.json();
  }

  private async synthesize(query: string, state: WorkflowState): Promise<string> {
    const resultSummary = Array.from(state.results.entries())
      .map(([id, val]) => `[${id}]: ${JSON.stringify(val).slice(0, 500)}`)
      .join("\n");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = process.env.AI_API_KEY;
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    try {
      const res = await fetch(`${AI_SERVER_URL}/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          system: "Synthesize a comprehensive answer from the sub-task results below. Be concise and cite sources.",
          message: `Original query: ${query}\n\nSub-task results:\n${resultSummary}`,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return "Failed to synthesize answer.";
      const data = await res.json();
      return data.response ?? data.message ?? data.content ?? "No answer generated.";
    } catch {
      return "Failed to synthesize answer from sub-task results.";
    }
  }
}
