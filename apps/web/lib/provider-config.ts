/**
 * Server-side provider configuration.
 * Persists active cloud provider settings to .sayknowmind-providers.json
 * so the ingestion pipeline can use API models when available.
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
 * Get ordered list of valid providers for AI calls.
 * Active provider comes first, then others with valid keys.
 */
export function getOrderedProviders(): ProviderEntry[] {
  const config = readProviderConfig();
  const valid = config.providers.filter((p) => p.apiKey && p.model && p.baseUrl);
  if (!config.activeProviderId) return valid;

  const active = valid.find((p) => p.id === config.activeProviderId);
  const rest = valid.filter((p) => p.id !== config.activeProviderId);
  return active ? [active, ...rest] : valid;
}
