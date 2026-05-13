/**
 * Codex model choices for ChatGPT-account authentication.
 *
 * Important: the plain `gpt-5` / `gpt-5-mini` API model IDs are not accepted
 * by Codex when it is authenticated through a ChatGPT subscription. The Codex
 * CLI publishes its own visible model slugs; keep this list to those slugs plus
 * the empty default, which lets the CLI pick the currently supported default.
 */

export const CODEX_DEFAULT_MODEL = "";

export const CODEX_MODEL_CHOICES: Array<{ value: string; label: string }> = [
  { value: CODEX_DEFAULT_MODEL, label: "Default (Codex recommended)" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

const KNOWN_UNSUPPORTED_CHATGPT_CODEX_MODELS = new Set([
  "codex-default",
  "gpt-5",
  "gpt-5-mini",
]);

/**
 * Normalize stored / submitted model IDs before sending them to Codex CLI.
 *
 * - Empty means "omit --model" so Codex chooses its account-supported default.
 * - Provider-prefixed Codex IDs fail with ChatGPT-account auth; the bare slug
 *   is what Codex expects.
 * - Known API-only / legacy placeholders collapse to default instead of
 *   breaking every queued relay job.
 */
export function normalizeCodexModel(model: string | null | undefined): string {
  const trimmed = typeof model === "string" ? model.trim() : "";
  if (!trimmed) return CODEX_DEFAULT_MODEL;

  const bare = trimmed.startsWith("openai-codex/")
    ? trimmed.slice("openai-codex/".length)
    : trimmed;

  if (KNOWN_UNSUPPORTED_CHATGPT_CODEX_MODELS.has(bare)) {
    return CODEX_DEFAULT_MODEL;
  }

  return bare.slice(0, 200);
}

export function codexRelayModel(model: string | null | undefined): string | null {
  const normalized = normalizeCodexModel(model);
  return normalized ? normalized : null;
}
