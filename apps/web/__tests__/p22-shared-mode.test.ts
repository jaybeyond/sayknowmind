/**
 * Property 22: Shared Mode Document encryption and upload
 * Property 23: Shared Mode permission revocation
 * Property 24: Shared Mode unauthorized access blocking
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import {
  buildLitAccessConditions,
  encryptWithLit,
  decryptWithLit,
  isSharedModeAvailable,
  isAccessValid,
  assertDocumentShareable,
  SharedModeError,
} from "@/lib/shared-mode";
import type { SharedContent, AccessConditions, AccessConditionType } from "@/lib/types";

describe("Property 22: Shared Mode Document encryption", () => {
  const originalEnv = process.env.PRIVATE_MODE;

  beforeEach(() => {
    process.env.PRIVATE_MODE = "false";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRIVATE_MODE = originalEnv;
    } else {
      delete process.env.PRIVATE_MODE;
    }
  });

  it("content is encrypted before upload", async () => {
    fc.assert(
      await fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 1000 }),
        async (content) => {
          const conditions = buildLitAccessConditions({ type: "public" });
          const encrypted = await encryptWithLit(content, conditions);

          // Encrypted payload has required fields
          expect(encrypted.ciphertext).toBeTruthy();
          expect(encrypted.dataToEncryptHash).toBeTruthy();
          expect(encrypted.accessControlConditions).toBeDefined();

          // Ciphertext is base64
          expect(() => Buffer.from(encrypted.ciphertext, "base64")).not.toThrow();

          // Hash is hex
          expect(encrypted.dataToEncryptHash).toMatch(/^[a-f0-9]+$/);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("encrypt-decrypt round trip works", async () => {
    const content = "Test document about AI and knowledge management";
    const conditions = buildLitAccessConditions({ type: "public" });
    const encrypted = await encryptWithLit(content, conditions);
    const decrypted = await decryptWithLit(encrypted);
    expect(decrypted).toBe(content);
  });

  it("encryption is blocked in Private Mode", async () => {
    process.env.PRIVATE_MODE = "true";
    const conditions = buildLitAccessConditions({ type: "public" });
    await expect(
      encryptWithLit("test", conditions),
    ).rejects.toThrow(SharedModeError);
  });
});

describe("Access Control Conditions", () => {
  it("public access generates valid condition", () => {
    const cond = buildLitAccessConditions({ type: "public" });
    expect(cond.length).toBe(1);
    expect(cond[0].chain).toBe("ethereum");
  });

  it("wallet access generates per-address conditions", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-f0-9]{40}$/), { minLength: 1, maxLength: 5 }),
        (addresses) => {
          const cond = buildLitAccessConditions({ type: "wallet", addresses });
          expect(cond.length).toBe(addresses.length);
          for (let i = 0; i < addresses.length; i++) {
            expect(cond[i].returnValueTest.value).toBe(addresses[i]);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("token access requires balance check", () => {
    const cond = buildLitAccessConditions({
      type: "token",
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      minBalance: "100",
    });
    expect(cond.length).toBe(1);
    expect(cond[0].standardContractType).toBe("ERC20");
    expect(cond[0].method).toBe("balanceOf");
    expect(cond[0].returnValueTest.value).toBe("100");
  });

  it("NFT access checks ownership", () => {
    const cond = buildLitAccessConditions({
      type: "nft",
      nftAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
    });
    expect(cond.length).toBe(1);
    expect(cond[0].standardContractType).toBe("ERC721");
    expect(cond[0].returnValueTest.comparator).toBe(">");
  });
});

describe("Property 23: Permission revocation", () => {
  it("revoked content is detected as invalid", () => {
    const accessTypes: AccessConditionType[] = ["public", "wallet", "token", "nft"];
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom(...accessTypes),
        (docId, userId, accessType) => {
          const shared: SharedContent = {
            id: "s1",
            documentId: docId,
            userId,
            isRevoked: true,
            revokedAt: new Date(),
            accessConditions: { type: accessType },
            createdAt: new Date(),
          };
          expect(isAccessValid(shared)).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("non-revoked content is valid", () => {
    const shared: SharedContent = {
      id: "s2",
      documentId: "d1",
      userId: "u1",
      ipfsCid: "Qm123",
      isRevoked: false,
      accessConditions: { type: "public" },
      createdAt: new Date(),
    };
    expect(isAccessValid(shared)).toBe(true);
  });
});

describe("Property 24: Unauthorized access blocking", () => {
  it("Shared Mode is unavailable when Private Mode is on", () => {
    const originalEnv = process.env.PRIVATE_MODE;
    process.env.PRIVATE_MODE = "true";
    expect(isSharedModeAvailable()).toBe(false);
    if (originalEnv !== undefined) {
      process.env.PRIVATE_MODE = originalEnv;
    } else {
      delete process.env.PRIVATE_MODE;
    }
  });

  it("Shared Mode is available when Private Mode is off", () => {
    const originalEnv = process.env.PRIVATE_MODE;
    process.env.PRIVATE_MODE = "false";
    expect(isSharedModeAvailable()).toBe(true);
    if (originalEnv !== undefined) {
      process.env.PRIVATE_MODE = originalEnv;
    } else {
      delete process.env.PRIVATE_MODE;
    }
  });

  it("SharedModeError has correct properties", () => {
    const err = new SharedModeError("access denied");
    expect(err.name).toBe("SharedModeError");
    expect(err.message).toBe("access denied");
    expect(err instanceof Error).toBe(true);
  });
});

describe("Per-document privacy enforcement in Shared Mode", () => {
  const originalEnv = process.env.PRIVATE_MODE;

  beforeEach(() => {
    process.env.PRIVATE_MODE = "false";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRIVATE_MODE = originalEnv;
    } else {
      delete process.env.PRIVATE_MODE;
    }
  });

  it("private document cannot be shared even when global mode allows", () => {
    expect(() => assertDocumentShareable("private")).toThrow(SharedModeError);
  });

  it("shared document can be shared when global mode allows", () => {
    expect(() => assertDocumentShareable("shared")).not.toThrow();
  });

  it("document inheriting private from category cannot be shared", () => {
    expect(() => assertDocumentShareable(undefined, "private")).toThrow(SharedModeError);
  });

  it("document inheriting shared from category can be shared", () => {
    expect(() => assertDocumentShareable(undefined, "shared")).not.toThrow();
  });

  it("document-level override beats category", () => {
    // Doc is shared, category is private → shareable
    expect(() => assertDocumentShareable("shared", "private")).not.toThrow();
    // Doc is private, category is shared → NOT shareable
    expect(() => assertDocumentShareable("private", "shared")).toThrow(SharedModeError);
  });

  it("global PRIVATE_MODE blocks even shared documents", () => {
    process.env.PRIVATE_MODE = "true";
    expect(() => assertDocumentShareable("shared", "shared")).toThrow(SharedModeError);
  });
});
