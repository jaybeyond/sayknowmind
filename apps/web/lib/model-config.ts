/**
 * Role-based model configuration.
 * Stores per-role model assignments in .sayknowmind-active-model as JSON.
 * Backwards-compatible: if the file is plain text, treats it as the "chat" role.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type ModelRole = "chat" | "ocr" | "embedding";

export interface ModelConfig {
  chat: string;
  ocr: string;
  embedding: string;
  ollamaEnabled: boolean;
}

const CONFIG_PATH = join(process.cwd(), ".sayknowmind-active-model");

const DEFAULTS: ModelConfig = {
  chat: process.env.LLM_MODEL ?? "qwen3:1.7b",
  ocr: "qwen3-vl:2b",
  embedding: "nomic-embed-text:latest",
  ollamaEnabled: false,
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
