/**
 * Property 19: Private Mode network blocking
 * Property 21: Private Mode telemetry blocking
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import {
  isAllowedInPrivateMode,
  isTelemetryDomain,
  isPrivateMode,
  getLLMEndpoint,
  getLLMModel,
  getStorageInfo,
  getPrivateModeStatus,
  resolveDocumentPrivacy,
  resolveCategoryPrivacy,
  canShare,
  PrivateModeError,
} from "@/lib/private-mode";

describe("Property 19: Private Mode network blocking", () => {
  const originalEnv = process.env.PRIVATE_MODE;

  beforeEach(() => {
    process.env.PRIVATE_MODE = "true";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRIVATE_MODE = originalEnv;
    } else {
      delete process.env.PRIVATE_MODE;
    }
  });

  it("external URLs are blocked in Private Mode", () => {
    const externalUrls = [
      "https://api.openai.com/v1/chat",
      "https://google.com",
      "https://example.com/api",
      "https://cdn.jsdelivr.net/script.js",
      "https://api.anthropic.com/v1/messages",
    ];
    for (const url of externalUrls) {
      expect(isAllowedInPrivateMode(url)).toBe(false);
    }
  });

  it("arbitrary external URLs are blocked", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        try {
          const parsed = new URL(url);
          const host = parsed.hostname;
          // Skip if it happens to be localhost/local
          if (
            host === "localhost" ||
            host === "127.0.0.1" ||
            host.startsWith("192.168.") ||
            host.startsWith("10.") ||
            host.startsWith("100.")
          ) {
            return;
          }
          expect(isAllowedInPrivateMode(url)).toBe(false);
        } catch {
          // Invalid URL - also blocked
          expect(isAllowedInPrivateMode(url)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("localhost and Docker hosts are allowed", () => {
    const allowedUrls = [
      "http://localhost:3000",
      "http://127.0.0.1:8080",
      "http://ollama:11434/api/generate",
      "http://postgres:5432",
      "http://edgequake:8080/query",
      "http://ai-server:4000/ai/chat",
    ];
    for (const url of allowedUrls) {
      expect(isAllowedInPrivateMode(url)).toBe(true);
    }
  });

  it("Tailscale IPs (100.x.x.x) are allowed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 64, max: 127 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (b, c, d) => {
          const url = `http://100.${b}.${c}.${d}:3000`;
          expect(isAllowedInPrivateMode(url)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("local network IPs are allowed", () => {
    const localUrls = [
      "http://192.168.1.100:3000",
      "http://10.0.0.5:8080",
      "http://172.16.0.1:3000",
    ];
    for (const url of localUrls) {
      expect(isAllowedInPrivateMode(url)).toBe(true);
    }
  });

  it("when Private Mode is off, all URLs are allowed", () => {
    process.env.PRIVATE_MODE = "false";
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        expect(isAllowedInPrivateMode(url)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe("Property 21: Private Mode telemetry blocking", () => {
  it("all known telemetry domains are detected", () => {
    const telemetryDomains = [
      "analytics.google.com",
      "sentry.io",
      "segment.io",
      "mixpanel.com",
      "amplitude.com",
      "telemetry.nextjs.org",
    ];
    for (const domain of telemetryDomains) {
      expect(isTelemetryDomain(domain)).toBe(true);
    }
  });

  it("non-telemetry domains pass", () => {
    const normalDomains = ["localhost", "example.com", "api.github.com"];
    for (const domain of normalDomains) {
      expect(isTelemetryDomain(domain)).toBe(false);
    }
  });
});

describe("Private Mode configuration", () => {
  const originalEnv = process.env.PRIVATE_MODE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRIVATE_MODE = originalEnv;
    } else {
      delete process.env.PRIVATE_MODE;
    }
  });

  it("LLM endpoint points to Ollama in Private Mode", () => {
    process.env.PRIVATE_MODE = "true";
    const endpoint = getLLMEndpoint();
    expect(endpoint).toContain("11434"); // Ollama port
  });

  it("LLM uses local model in Private Mode", () => {
    process.env.PRIVATE_MODE = "true";
    const model = getLLMModel();
    expect(model).toBeTruthy();
  });

  it("storage info shows local-only in Private Mode", () => {
    process.env.PRIVATE_MODE = "true";
    const info = getStorageInfo();
    expect(info.mode).toBe("private");
    expect(info.externalConnections).toBe(false);
  });

  it("status summary is correct", () => {
    process.env.PRIVATE_MODE = "true";
    const status = getPrivateModeStatus();
    expect(status.enabled).toBe(true);
    expect(status.storageMode).toBe("local-only");
    expect(status.telemetryBlocked).toBe(true);
  });

  it("PrivateModeError has correct name", () => {
    const err = new PrivateModeError("test");
    expect(err.name).toBe("PrivateModeError");
    expect(err.message).toBe("test");
    expect(err instanceof Error).toBe(true);
  });
});

describe("Per-document / per-category privacy resolution", () => {
  const originalEnv = process.env.PRIVATE_MODE;
  const originalLLM = process.env.LLM_MODEL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRIVATE_MODE = originalEnv;
    } else {
      delete process.env.PRIVATE_MODE;
    }
    if (originalLLM !== undefined) {
      process.env.LLM_MODEL = originalLLM;
    } else {
      delete process.env.LLM_MODEL;
    }
  });

  it("global PRIVATE_MODE=true overrides per-document 'shared'", () => {
    process.env.PRIVATE_MODE = "true";
    expect(resolveDocumentPrivacy("shared", "shared")).toBe("private");
  });

  it("document privacy overrides category privacy", () => {
    process.env.PRIVATE_MODE = "false";
    expect(resolveDocumentPrivacy("shared", "private")).toBe("shared");
    expect(resolveDocumentPrivacy("private", "shared")).toBe("private");
  });

  it("category privacy is used when document has no explicit setting", () => {
    process.env.PRIVATE_MODE = "false";
    expect(resolveDocumentPrivacy(undefined, "shared")).toBe("shared");
    expect(resolveDocumentPrivacy(undefined, "private")).toBe("private");
  });

  it("defaults to private when no privacy level set", () => {
    process.env.PRIVATE_MODE = "false";
    expect(resolveDocumentPrivacy(undefined, undefined)).toBe("private");
  });

  it("resolveCategoryPrivacy respects global mode", () => {
    process.env.PRIVATE_MODE = "true";
    expect(resolveCategoryPrivacy("shared")).toBe("private");
    process.env.PRIVATE_MODE = "false";
    expect(resolveCategoryPrivacy("shared")).toBe("shared");
    expect(resolveCategoryPrivacy(undefined)).toBe("private");
  });

  it("canShare returns false for private documents", () => {
    process.env.PRIVATE_MODE = "false";
    expect(canShare("private")).toBe(false);
    expect(canShare("shared")).toBe(true);
    expect(canShare(undefined, "shared")).toBe(true);
    expect(canShare(undefined, undefined)).toBe(false);
  });

  it("canShare always false when global PRIVATE_MODE=true", () => {
    process.env.PRIVATE_MODE = "true";
    expect(canShare("shared", "shared")).toBe(false);
  });

  it("default LLM model is Qwen/Qwen3.5-0.8B in Private Mode", () => {
    process.env.PRIVATE_MODE = "true";
    delete process.env.LLM_MODEL;
    expect(getLLMModel()).toBe("Qwen/Qwen3.5-0.8B");
  });

  it("privacy resolution with fast-check arbitrary levels", () => {
    process.env.PRIVATE_MODE = "false";
    fc.assert(
      fc.property(
        fc.constantFrom("private" as const, "shared" as const),
        fc.constantFrom("private" as const, "shared" as const),
        (docLevel, catLevel) => {
          const resolved = resolveDocumentPrivacy(docLevel, catLevel);
          // Document level always wins
          expect(resolved).toBe(docLevel);
        },
      ),
      { numRuns: 20 },
    );
  });
});
