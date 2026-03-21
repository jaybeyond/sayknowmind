/**
 * Property 18: Private Mode data local storage and encryption
 * Verify data is encrypted with AES-256-GCM before storage.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { encrypt, decrypt, getUserKey, encryptForUser, decryptForUser } from "@/lib/encryption";

describe("Property 18: Data encryption (AES-256-GCM)", () => {
  it("encrypt → decrypt round-trip preserves data for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10000 }), (plaintext) => {
        const key = getUserKey("test-user-id");
        const encrypted = encrypt(plaintext, key);
        const decrypted = decrypt(encrypted, key);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 200 },
    );
  });

  it("encrypted data is base64 encoded", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (plaintext) => {
        const key = getUserKey("user-1");
        const encrypted = encrypt(plaintext, key);
        // Valid base64
        expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
        const decoded = Buffer.from(encrypted, "base64");
        // IV (12) + AuthTag (16) + at least 1 byte ciphertext
        expect(decoded.length).toBeGreaterThanOrEqual(29);
      }),
      { numRuns: 100 },
    );
  });

  it("encrypted output differs from plaintext", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (plaintext) => {
        const key = getUserKey("user-2");
        const encrypted = encrypt(plaintext, key);
        expect(encrypted).not.toBe(plaintext);
      }),
      { numRuns: 100 },
    );
  });

  it("same plaintext produces different ciphertext each time (random IV)", () => {
    const plaintext = "hello world test data";
    const key = getUserKey("user-3");
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      results.add(encrypt(plaintext, key));
    }
    // All 10 should be unique due to random IV
    expect(results.size).toBe(10);
  });

  it("different users get different keys", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (userId1, userId2) => {
        if (userId1 === userId2) return;
        const key1 = getUserKey(userId1);
        const key2 = getUserKey(userId2);
        expect(key1.equals(key2)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("decryption fails with wrong key", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (plaintext) => {
        const key1 = getUserKey("user-a");
        const key2 = getUserKey("user-b");
        const encrypted = encrypt(plaintext, key1);
        expect(() => decrypt(encrypted, key2)).toThrow();
      }),
      { numRuns: 50 },
    );
  });

  it("encryptForUser/decryptForUser round-trip works", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 1000 }),
        (userId, plaintext) => {
          const encrypted = encryptForUser(userId, plaintext);
          const decrypted = decryptForUser(userId, encrypted);
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("key length is 256 bits (32 bytes)", () => {
    fc.assert(
      fc.property(fc.uuid(), (userId) => {
        const key = getUserKey(userId);
        expect(key.length).toBe(32);
      }),
      { numRuns: 50 },
    );
  });

  it("handles unicode and multi-byte characters", () => {
    const texts = [
      "한국어 테스트 데이터",
      "日本語テスト",
      "中文测试数据",
      "Emoji: 🔥🚀💡",
      "Mixed: Hello 안녕 こんにちは",
    ];
    const key = getUserKey("unicode-user");
    for (const text of texts) {
      const encrypted = encrypt(text, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(text);
    }
  });
});
