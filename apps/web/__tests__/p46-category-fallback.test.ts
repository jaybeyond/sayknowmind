import { describe, expect, it } from "vitest";
import { findSimilarCategoryByName, suggestFallbackCategory } from "@/lib/ingest/category-fallback";

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

  it("does not match short AI labels inside unrelated English words", () => {
    const suggestion = suggestFallbackCategory({
      title: "Chair maintenance notes",
      content: "Remember to mail the warranty claim and call support tomorrow.",
      existingCategories: [{ id: "cat-ai", name: "AI" }],
      language: "en",
    });

    expect(suggestion).toBeNull();
  });

  it("does not reuse unrelated categories that contain a short AI substring", () => {
    const suggestion = suggestFallbackCategory({
      title: "Agent runtime notes",
      content: "This document discusses LLM agents and OpenAI model orchestration.",
      existingCategories: [{ id: "cat-mail", name: "Mail" }],
      language: "en",
    });

    expect(suggestion).toMatchObject({
      categoryId: "new",
      categoryName: "AI",
    });
    expect(findSimilarCategoryByName([{ id: "cat-mail", name: "Mail" }], "AI")).toBeNull();
  });
});
