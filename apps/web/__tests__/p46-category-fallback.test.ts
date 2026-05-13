import { describe, expect, it } from "vitest";
import { suggestFallbackCategory } from "@/lib/ingest/category-fallback";

describe("category fallback suggestion", () => {
  it("creates a broad AI category when no categories exist", () => {
    const suggestion = suggestFallbackCategory({
      title: "FlowGram AI workflow framework",
      content: "FlowGram is a visual framework for building AI agents, LLM workflows, and RAG applications.",
      existingCategories: [],
      language: "ko",
    });

    expect(suggestion).toMatchObject({
      categoryId: "new",
      categoryName: "AI",
    });
    expect(suggestion?.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("reuses an existing matching category instead of creating a synonym", () => {
    const suggestion = suggestFallbackCategory({
      title: "Agent runtime notes",
      content: "This document discusses LLM agents and OpenAI model orchestration.",
      existingCategories: [{ id: "cat-ai", name: "인공지능" }],
      language: "ko",
    });

    expect(suggestion).toMatchObject({
      categoryId: "cat-ai",
      categoryName: "인공지능",
    });
  });

  it("does not create a category when no broad topic signal exists", () => {
    const suggestion = suggestFallbackCategory({
      title: "Untitled memo",
      content: "Remember to buy milk and call tomorrow.",
      existingCategories: [],
      language: "en",
    });

    expect(suggestion).toBeNull();
  });
});
