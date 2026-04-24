/**
 * Role-based model configuration.
 * Stores per-role model assignments in .sayknowmind-active-model as JSON.
 * Backwards-compatible: if the file is plain text, treats it as the "chat" role.
 *
 * Environment-aware: cloud mode disables Ollama by default and uses
 * cloud embedding providers. Desktop mode enables Ollama.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isCloud } from "./environment";

export type ModelRole = "chat" | "ocr" | "embedding";

export interface EmbeddingProviderInfo {
  provider: string;   // "ollama" | "openai" | "gemini" | "voyage" | "cohere"
  model: string;
  apiKey?: string;
}

export interface ModelConfig {
  chat: string;
  ocr: string;
  embedding: string;
  ollamaEnabled: boolean;
  /** Cloud embedding override (provider + model) */
  embeddingProvider?: EmbeddingProviderInfo;
}

const CONFIG_PATH = join(process.cwd(), ".sayknowmind-active-model");

// Server-side: use build-time env var directly (no window dependency)
const cloud = process.env.NEXT_PUBLIC_DEPLOY_MODE !== "desktop" && isCloud();

const DEFAULTS: ModelConfig = {
  chat: process.env.LLM_MODEL ?? "qwen3:1.7b",
  ocr: "qwen3-vl:2b",
  embedding: cloud ? "text-embedding-3-small" : "nomic-embed-text:latest",
  ollamaEnabled: !cloud,
  ...(cloud
    ? { embeddingProvider: { provider: "openai", model: "text-embedding-3-small" } }
    : {}),
};

export function readModelConfig(): ModelConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8").trim();
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
    // Legacy: plain text = chat model only
    return { ...DEFAULTS, chat: raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeModelConfig(config: Partial<ModelConfig>): ModelConfig {
  const current = readModelConfig();
  const merged = { ...current, ...config };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export function getModelForRole(role: ModelRole): string {
  return readModelConfig()[role];
}

export function isOllamaEnabled(): boolean {
  return readModelConfig().ollamaEnabled;
}

/** Get the active embedding provider config (cloud or local) */
export function getEmbeddingProvider(): EmbeddingProviderInfo {
  const config = readModelConfig();
  if (config.embeddingProvider) return config.embeddingProvider;
  return { provider: "ollama", model: config.embedding };
}
