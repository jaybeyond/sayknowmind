/**
 * Property 43: Codex ChatGPT-account model normalization
 *
 * The relay must never forward known API-only / placeholder model IDs to
 * ChatGPT-authenticated Codex, because Codex rejects them before producing an
 * answer.
 */
import { describe, expect, it } from "vitest";
import {
  CODEX_MODEL_CHOICES,
  codexRelayModel,
  normalizeCodexModel,
} from "@/lib/codex-models";

describe("Property 43: Codex model choices", () => {
  it("does not show known unsupported ChatGPT-account model IDs", () => {
    const values = CODEX_MODEL_CHOICES.map((choice) => choice.value);
    expect(values).not.toContain("codex-default");
    expect(values).not.toContain("gpt-5");
    expect(values).not.toContain("gpt-5-mini");
  });

  it("resets known unsupported model IDs to Codex default", () => {
    expect(normalizeCodexModel("codex-default")).toBe("");
    expect(normalizeCodexModel("gpt-5")).toBe("");
    expect(normalizeCodexModel("gpt-5-mini")).toBe("");
    expect(codexRelayModel("gpt-5")).toBeNull();
  });

  it("keeps supported Codex model slugs and strips rejected provider prefix", () => {
    expect(normalizeCodexModel("gpt-5.5")).toBe("gpt-5.5");
    expect(normalizeCodexModel("openai-codex/gpt-5.3-codex")).toBe("gpt-5.3-codex");
  });
});
