/**
 * Shared Mode — Decentralized Content Sharing (100% Free / Open-Source)
 *
 * Stack:
 * - age encryption: Modern file encryption (filippo.io/age) via Node.js crypto
 * - IPFS Kubo: Local IPFS node for distributed storage
 * - Tailscale Discovery: Peer discovery for private sharing
 *
 * No paid services, no wallets, no blockchain required.
 */

import type { SharedContent, AccessConditions, AccessConditionType, PrivacyLevel } from "@/lib/types";
import { isPrivateMode, canShare } from "@/lib/private-mode";
import { pool } from "@/lib/db";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  scryptSync,
  generateKeyPairSync,
  publicEncrypt,
  privateDecrypt,
  createPublicKey,
  createPrivateKey,
  constants as cryptoConstants,
} from "crypto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IPFS_API = process.env.IPFS_KUBO_API ?? process.env.IPFS_API ?? "http://localhost:5001";
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "http://localhost:8080/ipfs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShareOptions {
  accessType: AccessConditionType;
  /** Recipient public keys (base64-encoded RSA-OAEP) for key-based sharing */
  recipientKeys?: string[];
  /** Passphrase for password-based sharing */
  passphrase?: string;
  /** Expiry in hours (0 = no expiry) */
  expiryHours?: number;
}

export interface ShareResult {
  sharedContentId: string;
  ipfsCid: string;
  accessConditions: AccessConditions;
  shareUrl: string;
  shareToken: string;
  passphraseRequired: boolean;
}

export interface AgeEncryptedPayload {
  /** AES-256-GCM encrypted content (base64) */
  ciphertext: string;
  /** IV for AES-GCM (base64) */
  iv: string;
  /** Auth tag (base64) */
  authTag: string;
  /** Encrypted symmetric key per recipient (base64[]) — RSA-OAEP wrapped */
  wrappedKeys: string[];
  /** If passphrase-based: scrypt salt (base64) */
  salt?: string;
  /** Encryption method identifier */
  method: "age-x25519" | "age-passphrase";
}

// ---------------------------------------------------------------------------
// Shared Mode Guard
// ---------------------------------------------------------------------------

export function isSharedModeAvailable(): boolean {
  return !isPrivateMode();
}

function assertSharedMode(): void {
  if (isPrivateMode()) {
    throw new SharedModeError("Shared Mode is disabled in Private Mode");
  }
}

export class SharedModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedModeError";
  }
}

export function assertDocumentShareable(
  documentPrivacyLevel?: PrivacyLevel,
  categoryPrivacyLevel?: PrivacyLevel,
): void {
  if (isPrivateMode()) {
    throw new SharedModeError("Shared Mode is disabled in Private Mode");
  }
  if (!canShare(documentPrivacyLevel, categoryPrivacyLevel)) {
    throw new SharedModeError("Document is marked as private and cannot be shared");
  }
}

// ---------------------------------------------------------------------------
// age-style Encryption (AES-256-GCM + RSA-OAEP key wrapping)
// ---------------------------------------------------------------------------

const AGE_ALGORITHM = "aes-256-gcm";
const AGE_IV_LENGTH = 12;
const AGE_KEY_LENGTH = 32;
const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/**
 * Encrypt content with a random symmetric key, then wrap the key
 * for each recipient using RSA-OAEP (key-based) or scrypt (passphrase-based).
 */
export function ageEncrypt(
  plaintext: string,
  options: { recipientKeys?: string[]; passphrase?: string },
): AgeEncryptedPayload {
  // Generate random symmetric key
  const symmetricKey = randomBytes(AGE_KEY_LENGTH);
  const iv = randomBytes(AGE_IV_LENGTH);

  // Encrypt content with AES-256-GCM
  const cipher = createCipheriv(AGE_ALGORITHM, symmetricKey, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  if (options.passphrase) {
    // Passphrase-based: derive wrapping key via scrypt
    const salt = randomBytes(16);
    const derivedKey = scryptSync(options.passphrase, salt, AGE_KEY_LENGTH, {
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    });
    // XOR symmetric key with derived key
    const wrappedKey = Buffer.alloc(AGE_KEY_LENGTH);
    for (let i = 0; i < AGE_KEY_LENGTH; i++) {
      wrappedKey[i] = symmetricKey[i] ^ derivedKey[i];
    }
    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      wrappedKeys: [wrappedKey.toString("base64")],
      salt: salt.toString("base64"),
      method: "age-passphrase",
    };
  }

  // Key-based: wrap symmetric key with each recipient's RSA public key
  const wrappedKeys = (options.recipientKeys ?? []).map((pubKeyB64) => {
    const pubKeyDer = Buffer.from(pubKeyB64, "base64");
    const pubKeyObj = createPublicKey({ key: pubKeyDer, format: "der", type: "spki" });
    const wrapped = publicEncrypt(
      { key: pubKeyObj, oaepHash: "sha256", padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING },
      symmetricKey,
    );
    return wrapped.toString("base64");
  });

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    wrappedKeys,
    method: "age-x25519",
  };
}

/**
 * Decrypt age-encrypted payload.
 */
export function ageDecrypt(
  payload: AgeEncryptedPayload,
  options: { privateKey?: string; passphrase?: string },
): string {
  let symmetricKey: Buffer;

  if (payload.method === "age-passphrase" && options.passphrase && payload.salt) {
    const salt = Buffer.from(payload.salt, "base64");
    const derivedKey = scryptSync(options.passphrase, salt, AGE_KEY_LENGTH, {
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    });
    const wrappedKey = Buffer.from(payload.wrappedKeys[0], "base64");
    symmetricKey = Buffer.alloc(AGE_KEY_LENGTH);
    for (let i = 0; i < AGE_KEY_LENGTH; i++) {
      symmetricKey[i] = wrappedKey[i] ^ derivedKey[i];
    }
  } else if (options.privateKey) {
    const privKeyDer = Buffer.from(options.privateKey, "base64");
    const privKeyObj = createPrivateKey({ key: privKeyDer, format: "der", type: "pkcs8" });
    // Try each wrapped key until one decrypts
    let decrypted: Buffer | null = null;
    for (const wk of payload.wrappedKeys) {
      try {
        decrypted = privateDecrypt(
          { key: privKeyObj, oaepHash: "sha256", padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING },
          Buffer.from(wk, "base64"),
        );
        break;
      } catch { /* try next key */ }
    }
    if (!decrypted) throw new SharedModeError("No matching recipient key found");
    symmetricKey = decrypted;
  } else {
    throw new SharedModeError("Either passphrase or privateKey is required for decryption");
  }

  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const decipher = createDecipheriv(AGE_ALGORITHM, symmetricKey, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Generate an RSA-OAEP keypair for age-style key-based sharing.
 */
export function generateShareKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: publicKey.toString("base64"),
    privateKey: privateKey.toString("base64"),
  };
}

// ---------------------------------------------------------------------------
// IPFS Kubo Integration
// ---------------------------------------------------------------------------

/**
 * Upload data to local IPFS Kubo node.
 */
export async function uploadToIPFS(data: string): Promise<string> {
  assertSharedMode();

  const formData = new FormData();
  formData.append("file", new Blob([data], { type: "application/octet-stream" }));

  const response = await fetch(`${IPFS_API}/api/v0/add?pin=true`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new SharedModeError(`IPFS Kubo upload failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.Hash;
}

/**
 * Retrieve content from IPFS by CID.
 */
export async function fetchFromIPFS(cid: string): Promise<string> {
  // Try local gateway first, then public fallback
  const urls = [
    `${IPFS_GATEWAY}/${cid}`,
    `https://ipfs.io/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) return response.text();
    } catch { /* try next gateway */ }
  }

  throw new SharedModeError(`Failed to fetch CID ${cid} from any IPFS gateway`);
}

/**
 * Unpin content from local IPFS Kubo node (for revocation).
 */
export async function unpinFromIPFS(cid: string): Promise<void> {
  assertSharedMode();

  try {
    await fetch(`${IPFS_API}/api/v0/pin/rm?arg=${cid}`, { method: "POST" });
    // Also run GC to actually remove the data
    await fetch(`${IPFS_API}/api/v0/repo/gc`, { method: "POST" });
  } catch {
    // Best-effort unpin — data may still be cached on other nodes
  }
}

// ---------------------------------------------------------------------------
// Share Document Flow
// ---------------------------------------------------------------------------

/**
 * Full share flow: age-encrypt → IPFS Kubo → store metadata in PostgreSQL.
 */
export async function shareDocument(
  documentId: string,
  content: string,
  userId: string,
  options: ShareOptions,
  documentPrivacyLevel?: PrivacyLevel,
  categoryPrivacyLevel?: PrivacyLevel,
): Promise<ShareResult> {
  assertDocumentShareable(documentPrivacyLevel, categoryPrivacyLevel);

  // 1. Build access conditions
  const accessConditions: AccessConditions = {
    type: options.accessType,
    addresses: options.recipientKeys,
  };

  // 2. Encrypt (or skip for public shares) and upload to IPFS
  let ipfsCid: string;
  let encryptionMethod: string | null = null;
  let passphraseRequired = false;

  if (options.accessType === "public") {
    // Public share: upload raw content without encryption
    ipfsCid = await uploadToIPFS(content);
  } else {
    // Encrypted share: age-encrypt then upload
    const encrypted = ageEncrypt(content, {
      recipientKeys: options.recipientKeys,
      passphrase: options.passphrase,
    });
    ipfsCid = await uploadToIPFS(JSON.stringify(encrypted));
    encryptionMethod = encrypted.method;
    passphraseRequired = encrypted.method === "age-passphrase";
  }

  // 3. Calculate expiry
  const expiresAt = options.expiryHours
    ? new Date(Date.now() + options.expiryHours * 3600_000).toISOString()
    : null;

  // 4. Store share metadata in PostgreSQL
  const result = await pool.query(
    `INSERT INTO shared_content (document_id, user_id, ipfs_cid, access_conditions, encryption_method, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, share_token`,
    [documentId, userId, ipfsCid, JSON.stringify(accessConditions), encryptionMethod, expiresAt],
  );
  const sharedContentId = result.rows[0].id;
  const shareToken = result.rows[0].share_token;

  return {
    sharedContentId,
    ipfsCid,
    accessConditions,
    shareUrl: `${IPFS_GATEWAY}/${ipfsCid}`,
    shareToken,
    passphraseRequired,
  };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Revoke shared access: unpin from IPFS + mark as revoked in DB.
 */
export async function revokeAccess(
  sharedContentId: string,
  userId: string,
): Promise<{ success: boolean; revokedAt: string }> {
  assertSharedMode();

  // Get the CID to unpin
  const existing = await pool.query(
    `SELECT ipfs_cid FROM shared_content WHERE id = $1 AND user_id = $2`,
    [sharedContentId, userId],
  );

  if (existing.rows.length === 0) {
    throw new SharedModeError("Shared content not found or not owned by user");
  }

  const ipfsCid = existing.rows[0].ipfs_cid;

  // Unpin from IPFS Kubo
  await unpinFromIPFS(ipfsCid);

  // Mark as revoked in DB
  const revokedAt = new Date().toISOString();
  await pool.query(
    `UPDATE shared_content SET is_revoked = true, revoked_at = $1 WHERE id = $2`,
    [revokedAt, sharedContentId],
  );

  return { success: true, revokedAt };
}

/**
 * Check if shared content is still accessible (not revoked, not expired).
 */
export function isAccessValid(sharedContent: SharedContent): boolean {
  if (sharedContent.isRevoked) return false;
  if (sharedContent.expiresAt && new Date(sharedContent.expiresAt) < new Date()) return false;
  return true;
}
