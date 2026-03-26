/**
 * Server-side provider configuration.
 * Persists active cloud provider settings to .sayknowmind-providers.json
 * so the ingestion pipeline can use API models when available.
 *
 * Also checks environment variables (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.)
 * as fallback — so Railway deploys work without the JSON file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProviderEntry {
  id: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ProviderConfig {
  activeProviderId: string;
  providers: ProviderEntry[];
}

const CONFIG_PATH = join(process.cwd(), ".sayknowmind-providers.json");

const EMPTY: ProviderConfig = { activeProviderId: "", providers: [] };

/** Well-known providers that can be auto-configured from env vars. */
const ENV_PROVIDERS: Array<{
  envKey: string;
  id: string;
  baseUrl: string;
  model: string;
}> = [
  {
    envKey: "OPENROUTER_API_KEY",
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api",
    model: "google/gemini-2.0-flash-001",
  },
  {
    envKey: "OPENAI_API_KEY",
    id: "openai",
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
  },
];

export function readProviderConfig(): ProviderConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8").trim();
    const parsed = JSON.parse(raw);
    return {
      activeProviderId: parsed.activeProviderId ?? "",
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeProviderConfig(config: ProviderConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Build provider entries from environment variables.
 * Only includes providers whose env var is set and not a placeholder.
 */
function getEnvProviders(): ProviderEntry[] {
  const entries: ProviderEntry[] = [];
  for (const ep of ENV_PROVIDERS) {
    const key = process.env[ep.envKey];
    if (key && key.length > 10 && !key.startsWith("<")) {
      entries.push({ id: ep.id, apiKey: key, model: ep.model, baseUrl: ep.baseUrl });
    }
  }
  return entries;
}

/**
 * Get ordered list of valid providers for AI calls.
 * 1. JSON config file providers (active first)
 * 2. Env var providers as fallback (when JSON is empty/missing)
 */
export function getOrderedProviders(): ProviderEntry[] {
  const config = readProviderConfig();
  const valid = config.providers.filter((p) => p.apiKey && p.model && p.baseUrl);

  // If no file-based providers, fall back to env vars
  const providers = valid.length > 0 ? valid : getEnvProviders();

  if (!config.activeProviderId) return providers;

  const active = providers.find((p) => p.id === config.activeProviderId);
  const rest = providers.filter((p) => p.id !== config.activeProviderId);
  return active ? [active, ...rest] : providers;
}
