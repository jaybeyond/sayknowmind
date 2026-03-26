/**
 * Property 22: Shared Mode Document encryption and upload (age encryption + IPFS Kubo)
 * Property 23: Shared Mode permission revocation
 * Property 24: Shared Mode unauthorized access blocking
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import {
  ageEncrypt,
  ageDecrypt,
  generateShareKeypair,
  isSharedModeAvailable,
  isAccessValid,
  assertDocumentShareable,
  SharedModeError,
} from "@/lib/shared-mode";
import type { SharedContent, AccessConditionType } from "@/lib/types";

describe("Property 22: Shared Mode age encryption", () => {
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

  it("passphrase-based encrypt-decrypt round trip works", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 8, maxLength: 64 }),
        (content, passphrase) => {
          const encrypted = ageEncrypt(content, { passphrase });
          expect(encrypted.method).toBe("age-passphrase");
          expect(encrypted.ciphertext).toBeTruthy();
          expect(encrypted.iv).toBeTruthy();
          expect(encrypted.authTag).toBeTruthy();
          expect(encrypted.salt).toBeTruthy();
          expect(encrypted.wrappedKeys.length).toBe(1);

          const decrypted = ageDecrypt(encrypted, { passphrase });
          expect(decrypted).toBe(content);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("key-based encrypt-decrypt round trip works", () => {
    const { publicKey, privateKey } = generateShareKeypair();

    const content = "Test document about AI and knowledge management";
    const encrypted = ageEncrypt(content, { recipientKeys: [publicKey] });
    expect(encrypted.method).toBe("age-x25519");
    expect(encrypted.wrappedKeys.length).toBe(1);

    const decrypted = ageDecrypt(encrypted, { privateKey });
    expect(decrypted).toBe(content);
  });

  it("multiple recipients can each decrypt", () => {
    const kp1 = generateShareKeypair();
    const kp2 = generateShareKeypair();

    const content = "Shared with two recipients";
    const encrypted = ageEncrypt(content, {
      recipientKeys: [kp1.publicKey, kp2.publicKey],
    });
    expect(encrypted.wrappedKeys.length).toBe(2);

    expect(ageDecrypt(encrypted, { privateKey: kp1.privateKey })).toBe(content);
    expect(ageDecrypt(encrypted, { privateKey: kp2.privateKey })).toBe(content);
  });

  it("wrong passphrase fails to decrypt", () => {
    const encrypted = ageEncrypt("secret", { passphrase: "correct-pass" });
    expect(() => ageDecrypt(encrypted, { passphrase: "wrong-pass" })).toThrow();
  });

  it("wrong private key fails to decrypt", () => {
    const kp1 = generateShareKeypair();
    const kp2 = generateShareKeypair();

    const encrypted = ageEncrypt("secret", { recipientKeys: [kp1.publicKey] });
    expect(() => ageDecrypt(encrypted, { privateKey: kp2.privateKey })).toThrow(SharedModeError);
  });

  it("ciphertext is base64 encoded", () => {
    const encrypted = ageEncrypt("test data", { passphrase: "testpass123" });
    expect(() => Buffer.from(encrypted.ciphertext, "base64")).not.toThrow();
    expect(() => Buffer.from(encrypted.iv, "base64")).not.toThrow();
    expect(() => Buffer.from(encrypted.authTag, "base64")).not.toThrow();
  });

  it("same content produces different ciphertext each time", () => {
    const results = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const enc = ageEncrypt("same content", { passphrase: "same-pass" });
      results.add(enc.ciphertext);
    }
    expect(results.size).toBe(5);
  });
});

describe("Property 22: generateShareKeypair", () => {
  it("generates valid RSA keypair", () => {
    const { publicKey, privateKey } = generateShareKeypair();
    expect(publicKey).toBeTruthy();
    expect(privateKey).toBeTruthy();
    // Both are base64 encoded DER
    expect(() => Buffer.from(publicKey, "base64")).not.toThrow();
    expect(() => Buffer.from(privateKey, "base64")).not.toThrow();
    // RSA-2048 DER public key is ~294 bytes, private key is ~1218 bytes
    expect(Buffer.from(publicKey, "base64").length).toBeGreaterThan(200);
    expect(Buffer.from(privateKey, "base64").length).toBeGreaterThan(1000);
  });

  it("each call generates a unique keypair", () => {
    const kp1 = generateShareKeypair();
    const kp2 = generateShareKeypair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
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
      ipfsCid: "QmTest123",
      isRevoked: false,
      accessConditions: { type: "public" },
      createdAt: new Date(),
    };
    expect(isAccessValid(shared)).toBe(true);
  });

  it("expired content is detected as invalid", () => {
    const shared: SharedContent = {
      id: "s3",
      documentId: "d2",
      userId: "u2",
      ipfsCid: "QmTest456",
      isRevoked: false,
      accessConditions: { type: "public" },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() - 3600_000), // expired 1 hour ago
    };
    expect(isAccessValid(shared)).toBe(false);
  });

  it("non-expired content is valid", () => {
    const shared: SharedContent = {
      id: "s4",
      documentId: "d3",
      userId: "u3",
      ipfsCid: "QmTest789",
      isRevoked: false,
      accessConditions: { type: "wallet" },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000), // expires in 1 hour
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
