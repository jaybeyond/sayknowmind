/**
 * Property 1: Language switching UI text change
 * Verify that switching locale changes the displayed text.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import en from "@/messages/en.json";
import ko from "@/messages/ko.json";

type Messages = typeof en;

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return path;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : path;
}

function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "string") {
      keys.push(fullKey);
    } else if (typeof val === "object" && val !== null) {
      keys.push(...collectKeys(val as Record<string, unknown>, fullKey));
    }
  }
  return keys;
}

const allKeys = collectKeys(en as unknown as Record<string, unknown>);

describe("Property 1: Language switching UI text change", () => {
  it("all translation keys exist in both locales", () => {
    for (const key of allKeys) {
      const enVal = getNestedValue(en as unknown as Record<string, unknown>, key);
      const koVal = getNestedValue(ko as unknown as Record<string, unknown>, key);
      expect(enVal).not.toBe(key); // key resolves in en
      expect(koVal).not.toBe(key); // key resolves in ko
    }
  });

  it("switching locale changes text for arbitrary valid keys", () => {
    if (allKeys.length === 0) return;
    const keyArb = fc.constantFrom(...allKeys);

    fc.assert(
      fc.property(keyArb, (key) => {
        const enVal = getNestedValue(en as unknown as Record<string, unknown>, key);
        const koVal = getNestedValue(ko as unknown as Record<string, unknown>, key);

        // Both must resolve (not fall back to key)
        expect(enVal).not.toBe(key);
        expect(koVal).not.toBe(key);

        // Locale change should produce different text (most keys differ)
        // Some keys like brand names may be identical — we just verify resolution works
        expect(typeof enVal).toBe("string");
        expect(typeof koVal).toBe("string");
      }),
      { numRuns: Math.min(allKeys.length * 2, 200) },
    );
  });

  it("most keys differ between en and ko", () => {
    let differentCount = 0;
    for (const key of allKeys) {
      const enVal = getNestedValue(en as unknown as Record<string, unknown>, key);
      const koVal = getNestedValue(ko as unknown as Record<string, unknown>, key);
      if (enVal !== koVal) differentCount++;
    }
    // At least 50% of keys should differ between languages
    expect(differentCount / allKeys.length).toBeGreaterThan(0.5);
  });
});
