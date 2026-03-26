import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "crypto";

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption Layer (Hardened)
//
// Improvements over original:
// - scrypt KDF (memory-hard) instead of double-SHA-256
// - HMAC-SHA-256 integrity verification on encrypted payloads
// - Version byte for future algorithm migration
// - Constant-time comparison for auth tags and HMACs
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;       // 96 bits recommended for GCM
const TAG_LENGTH = 16;      // 128-bit auth tag
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;      // 256 bits
const VERSION = 0x02;       // v2 = scrypt + HMAC

// scrypt parameters (OWASP recommended)
const SCRYPT_N = 2 ** 14;   // CPU/memory cost (16384)
const SCRYPT_R = 8;         // Block size
const SCRYPT_P = 1;         // Parallelism

// ---------------------------------------------------------------------------
// Key Derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 256-bit encryption key using scrypt (memory-hard KDF).
 * Resistant to GPU/ASIC brute-force attacks.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/**
 * Derive an HMAC key separate from the encryption key.
 * Uses a different salt derivation to ensure key separation.
 */
function deriveHmacKey(secret: string, salt: Buffer): Buffer {
  const hmacSalt = createHash("sha256").update(Buffer.concat([salt, Buffer.from("hmac")])).digest();
  return scryptSync(secret, hmacSalt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/**
 * Legacy key derivation (v1) for backward compatibility.
 */
function deriveKeyLegacy(secret: string, salt: Buffer): Buffer {
  const hash1 = createHash("sha256").update(Buffer.concat([Buffer.from(secret), salt])).digest();
  return createHash("sha256").update(Buffer.concat([hash1, salt])).digest();
}

/**
 * Generate a per-user encryption key from the master secret and user ID.
 */
export function getUserKey(userId: string): Buffer {
  const masterSecret = process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!masterSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_KEY or BETTER_AUTH_SECRET must be set in production. " +
        "Generate one with: openssl rand -hex 32",
      );
    }
    console.warn("[encryption] WARNING: Using insecure dev key. Set ENCRYPTION_KEY for production.");
  }
  const secret = masterSecret ?? "dev-only-not-for-production";
  const salt = createHash("sha256").update(userId).digest();
  return deriveKey(secret, salt);
}

/**
 * Get the master secret string (for HMAC key derivation).
 */
function getMasterSecret(): string {
  return process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET ?? "dev-only-not-for-production";
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt (v2 — scrypt + HMAC)
// ---------------------------------------------------------------------------

/**
 * Encrypt data using AES-256-GCM with HMAC integrity.
 *
 * Wire format (base64-encoded):
 *   [version: 1B] [salt: 32B] [iv: 12B] [authTag: 16B] [ciphertext: N] [hmac: 32B]
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Assemble payload (without HMAC)
  const payload = Buffer.concat([
    Buffer.from([VERSION]),
    salt,
    iv,
    authTag,
    encrypted,
  ]);

  // Compute HMAC over the entire payload
  const hmacKey = deriveHmacKey(getMasterSecret(), salt);
  const hmac = createHmac("sha256", hmacKey).update(payload).digest();

  const result = Buffer.concat([payload, hmac]);
  return result.toString("base64");
}

/**
 * Decrypt data using AES-256-GCM with HMAC verification.
 * Supports both v1 (legacy) and v2 (scrypt+HMAC) formats.
 */
export function decrypt(encryptedBase64: string, key: Buffer): string {
  const data = Buffer.from(encryptedBase64, "base64");

  // Detect version
  const version = data[0];

  if (version === VERSION) {
    return decryptV2(data, key);
  }

  // Legacy v1 format: [iv: 12B] [authTag: 16B] [ciphertext: N]
  return decryptV1(data, key);
}

function decryptV2(data: Buffer, key: Buffer): string {
  // Parse: [version: 1B] [salt: 32B] [iv: 12B] [authTag: 16B] [ciphertext: N] [hmac: 32B]
  const HMAC_LENGTH = 32;
  const headerLen = 1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH;

  if (data.length < headerLen + HMAC_LENGTH) {
    throw new Error("Encrypted data too short");
  }

  const payload = data.subarray(0, data.length - HMAC_LENGTH);
  const storedHmac = data.subarray(data.length - HMAC_LENGTH);

  const salt = payload.subarray(1, 1 + SALT_LENGTH);

  // Verify HMAC first (before any decryption)
  const hmacKey = deriveHmacKey(getMasterSecret(), salt);
  const computedHmac = createHmac("sha256", hmacKey).update(payload).digest();

  if (!timingSafeEqual(storedHmac, computedHmac)) {
    throw new Error("HMAC verification failed — data may be tampered");
  }

  const iv = payload.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
  const authTag = payload.subarray(1 + SALT_LENGTH + IV_LENGTH, headerLen);
  const ciphertext = payload.subarray(headerLen);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

function decryptV1(data: Buffer, key: Buffer): string {
  // Legacy format: [iv: 12B] [authTag: 16B] [ciphertext: N]
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export function encryptForUser(userId: string, plaintext: string): string {
  const key = getUserKey(userId);
  return encrypt(plaintext, key);
}

export function decryptForUser(userId: string, ciphertext: string): string {
  const key = getUserKey(userId);
  return decrypt(ciphertext, key);
}

// ---------------------------------------------------------------------------
// Field-level encryption helpers for database columns
// ---------------------------------------------------------------------------

/**
 * Encrypt a specific field value for storage in PostgreSQL.
 * Returns null if the input is null/undefined.
 */
export function encryptField(userId: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  return encryptForUser(userId, value);
}

/**
 * Decrypt a specific field value from PostgreSQL.
 * Returns null if the input is null/undefined.
 */
export function decryptField(userId: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  try {
    return decryptForUser(userId, value);
  } catch {
    // Return raw value if decryption fails (unencrypted legacy data)
    return value;
  }
}

/**
 * Encrypt an entire object's string fields.
 */
export function encryptObject<T extends Record<string, unknown>>(
  userId: string,
  obj: T,
  fieldsToEncrypt: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fieldsToEncrypt) {
    const val = result[field];
    if (typeof val === "string") {
      (result as Record<string, unknown>)[field as string] = encryptForUser(userId, val);
    }
  }
  return result;
}

/**
 * Decrypt an entire object's string fields.
 */
export function decryptObject<T extends Record<string, unknown>>(
  userId: string,
  obj: T,
  fieldsToDecrypt: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fieldsToDecrypt) {
    const val = result[field];
    if (typeof val === "string") {
      (result as Record<string, unknown>)[field as string] = decryptField(userId, val);
    }
  }
  return result;
}
