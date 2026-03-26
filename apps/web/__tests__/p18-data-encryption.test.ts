/**
 * Property 18: Private Mode data local storage and encryption
 * Verify data is encrypted with AES-256-GCM (v2: scrypt + HMAC) before storage.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { encrypt, decrypt, getUserKey, encryptForUser, decryptForUser } from "@/lib/encryption";

describe("Property 18: Data encryption (AES-256-GCM)", () => {
  // Pre-derive keys once to avoid repeated scrypt cost in property tests
  const testKey = getUserKey("test-user-id");
  const keyUser1 = getUserKey("user-1");
  const keyUser2 = getUserKey("user-2");
  const keyUser3 = getUserKey("user-3");
  const keyUserA = getUserKey("user-a");
  const keyUserB = getUserKey("user-b");
  const keyUnicode = getUserKey("unicode-user");

  it("encrypt → decrypt round-trip preserves data for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10000 }), (plaintext) => {
        const encrypted = encrypt(plaintext, testKey);
        const decrypted = decrypt(encrypted, testKey);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 50 },
    );
  });

  it("encrypted data is base64 encoded", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (plaintext) => {
        const encrypted = encrypt(plaintext, keyUser1);
        // Valid base64
        expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
        const decoded = Buffer.from(encrypted, "base64");
        // v2 format: version(1) + salt(32) + IV(12) + authTag(16) + ciphertext(>=1) + hmac(32) = min 94
        expect(decoded.length).toBeGreaterThanOrEqual(94);
        // First byte is version 0x02
        expect(decoded[0]).toBe(0x02);
      }),
      { numRuns: 30 },
    );
  });

  it("encrypted output differs from plaintext", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (plaintext) => {
        const encrypted = encrypt(plaintext, keyUser2);
        expect(encrypted).not.toBe(plaintext);
      }),
      { numRuns: 30 },
    );
  });

  it("same plaintext produces different ciphertext each time (random IV)", () => {
    const plaintext = "hello world test data";
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      results.add(encrypt(plaintext, keyUser3));
    }
    // All 10 should be unique due to random IV + salt
    expect(results.size).toBe(10);
  });

  it("different users get different keys", () => {
    // Pre-derive a few keys and compare
    const keys = ["uid-aaa", "uid-bbb", "uid-ccc", "uid-ddd"].map((id) => getUserKey(id));
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(keys[i].equals(keys[j])).toBe(false);
      }
    }
  });

  it("decryption fails with wrong key", () => {
    const plaintext = "secret data for user A";
    const encrypted = encrypt(plaintext, keyUserA);
    expect(() => decrypt(encrypted, keyUserB)).toThrow();
  });

  it("encryptForUser/decryptForUser round-trip works", () => {
    const userId = "round-trip-user";
    const texts = ["hello", "한국어 데이터", "emoji 🔥🚀", "a".repeat(500)];
    for (const plaintext of texts) {
      const encrypted = encryptForUser(userId, plaintext);
      const decrypted = decryptForUser(userId, encrypted);
      expect(decrypted).toBe(plaintext);
    }
  });

  it("key length is 256 bits (32 bytes)", () => {
    const key = getUserKey("key-length-check");
    expect(key.length).toBe(32);
  });

  it("handles unicode and multi-byte characters", () => {
    const texts = [
      "한국어 테스트 데이터",
      "日本語テスト",
      "中文测试数据",
      "Emoji: 🔥🚀💡",
      "Mixed: Hello 안녕 こんにちは",
    ];
    for (const text of texts) {
      const encrypted = encrypt(text, keyUnicode);
      const decrypted = decrypt(encrypted, keyUnicode);
      expect(decrypted).toBe(text);
    }
  });
});
