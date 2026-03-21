import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption Layer
// Provides per-user encryption key derivation and data encrypt/decrypt
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag
const SALT_LENGTH = 32;

/**
 * Derive a 256-bit encryption key from a user-specific secret and a salt.
 * Uses PBKDF2-like approach with SHA-256 for simplicity.
 * In production, consider using scrypt or Argon2.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  // Two rounds of SHA-256 with salt for key derivation
  const hash1 = createHash("sha256").update(Buffer.concat([Buffer.from(secret), salt])).digest();
  return createHash("sha256").update(Buffer.concat([hash1, salt])).digest();
}

/**
 * Generate a per-user encryption key from the master secret and user ID.
 * Throws at startup if no key is configured in production.
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
    // Dev fallback — never use in production
    console.warn("[encryption] WARNING: Using insecure dev key. Set ENCRYPTION_KEY for production.");
  }
  const secret = masterSecret ?? "dev-only-not-for-production";
  const salt = createHash("sha256").update(userId).digest();
  return deriveKey(secret, salt);
}

/**
 * Encrypt data using AES-256-GCM.
 * Returns a base64 string containing: salt + iv + authTag + ciphertext.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv (12 bytes) + authTag (16 bytes) + ciphertext
  const result = Buffer.concat([iv, authTag, encrypted]);
  return result.toString("base64");
}

/**
 * Decrypt data using AES-256-GCM.
 * Expects a base64 string containing: iv + authTag + ciphertext.
 */
export function decrypt(encryptedBase64: string, key: Buffer): string {
  const data = Buffer.from(encryptedBase64, "base64");

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypt user data with their derived key.
 */
export function encryptForUser(userId: string, plaintext: string): string {
  const key = getUserKey(userId);
  return encrypt(plaintext, key);
}

/**
 * Decrypt user data with their derived key.
 */
export function decryptForUser(userId: string, ciphertext: string): string {
  const key = getUserKey(userId);
  return decrypt(ciphertext, key);
}
