/**
 * UltraRAG YAML Pipeline Parser
 *
 * Parses YAML pipeline definitions into typed UltraRAGPipeline objects.
 * Uses a lightweight YAML parser (no external dependency — JSON-compatible subset).
 */

import type { UltraRAGPipeline } from "./types";
import { validatePipeline } from "./validator";

/**
 * Parse a YAML pipeline string into a validated UltraRAGPipeline.
 * Supports JSON as well (YAML superset).
 */
export function parsePipeline(yamlOrJson: string): {
  pipeline: UltraRAGPipeline | null;
  errors: string[];
} {
  let parsed: unknown;

  try {
    // Try JSON first (YAML is a superset of JSON)
    parsed = JSON.parse(yamlOrJson);
  } catch {
    // Fall back to simple YAML parsing
    try {
      parsed = parseSimpleYaml(yamlOrJson);
    } catch (e) {
      return {
        pipeline: null,
        errors: [`YAML parse error: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  }

  const validation = validatePipeline(parsed);
  if (!validation.valid) {
    return { pipeline: null, errors: validation.errors };
  }

  return { pipeline: parsed as UltraRAGPipeline, errors: [] };
}

/**
 * Minimal YAML-like parser for pipeline definitions.
 * Handles the subset needed for pipeline configs (maps, arrays, scalars).
 * For full YAML support, install js-yaml.
 */
function parseSimpleYaml(yaml: string): unknown {
  const lines = yaml.split("\n");
  const result: Record<string, unknown> = {};
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
    { obj: result, indent: -1 },
  ];
  let currentArray: unknown[] | null = null;
  let currentArrayKey = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Array item
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim();
      if (currentArray) {
        currentArray.push(parseScalar(value));
      } else {
        // First array item under a key — convert the last key's value to an array
        const parent = stack[stack.length - 1].obj;
        const keys = Object.keys(parent);
        if (keys.length > 0) {
          const lastKey = keys[keys.length - 1];
          const arr: unknown[] = [parseScalar(value)];
          parent[lastKey] = arr;
          currentArray = arr;
          currentArrayKey = lastKey;
        }
      }
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();

      // Pop stack to correct indent level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;

      if (rawValue === "" || rawValue === "|" || rawValue === ">") {
        // Nested object or array follows
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ obj: child, indent });
        currentArray = null;
      } else if (rawValue.startsWith("[")) {
        // Inline array
        try {
          parent[key] = JSON.parse(rawValue);
        } catch {
          parent[key] = rawValue;
        }
        currentArray = null;
      } else {
        parent[key] = parseScalar(rawValue);
        currentArray = null;
      }
    }
  }

  return result;
}

function parseScalar(value: string): string | number | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  // Strip quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
