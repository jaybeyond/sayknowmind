/**
 * Per-user OAuth token storage.
 *
 * - Tokens are encrypted at rest with AES-256-GCM keyed by ENCRYPTION_KEY.
 * - Every read/write goes through (userId, provider) so cross-user lookup
 *   is impossible at the storage layer.
 * - Refresh tokens are stored separately and may be null (some providers
 *   never issue them; others issue them only on first connect).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { pool } from "@/lib/db";
import type { ConnectorId, ConnectedAccount } from "./_interface";

// AES-256-GCM constants
const ALGO = "aes-256-gcm" as const;
const IV_LENGTH = 12;        // 96-bit IV is the GCM standard
const AUTH_TAG_LENGTH = 16;  // 128-bit auth tag

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY env var is required for integration token storage. " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  // Accept either 32-byte hex or any string (we hash the latter to 32 bytes
  // so misconfigured deployments don't crash, but hex is the documented form).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw).digest();
}

interface EncryptedField {
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64
}

function encrypt(plaintext: string): EncryptedField {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(field: EncryptedField): string {
  const key = getKey();
  const iv = Buffer.from(field.iv, "base64");
  const tag = Buffer.from(field.tag, "base64");
  const ct = Buffer.from(field.ciphertext, "base64");
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ───────────────────────────────────────────────────────────────────────────

export interface StoredToken {
  userId: string;
  provider: ConnectorId;
  accountId: string;
  accountEmail?: string;
  accountLabel?: string;
  scope?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  metadata: Record<string, unknown>;
}

export interface UpsertTokenInput {
  userId: string;
  provider: ConnectorId;
  accountId: string;
  accountEmail?: string;
  accountLabel?: string;
  scope?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

/** Save (or replace) a user's token for a specific connected account. */
export async function upsertToken(input: UpsertTokenInput): Promise<void> {
  const access = encrypt(input.accessToken);
  const refresh = input.refreshToken ? encrypt(input.refreshToken) : null;

  await pool.query(
    `
    INSERT INTO user_integration_tokens
      (user_id, provider, account_id, account_email, account_label, scope,
       access_token, access_iv, access_tag,
       refresh_token, refresh_iv, refresh_tag,
       expires_at, metadata)
    VALUES
      ($1, $2, $3, $4, $5, $6,
       $7, $8, $9,
       $10, $11, $12,
       $13, $14)
    ON CONFLICT (user_id, provider, account_id)
    DO UPDATE SET
      account_email = EXCLUDED.account_email,
      account_label = EXCLUDED.account_label,
      scope         = EXCLUDED.scope,
      access_token  = EXCLUDED.access_token,
      access_iv     = EXCLUDED.access_iv,
      access_tag    = EXCLUDED.access_tag,
      refresh_token = COALESCE(EXCLUDED.refresh_token, user_integration_tokens.refresh_token),
      refresh_iv    = COALESCE(EXCLUDED.refresh_iv,    user_integration_tokens.refresh_iv),
      refresh_tag   = COALESCE(EXCLUDED.refresh_tag,   user_integration_tokens.refresh_tag),
      expires_at    = EXCLUDED.expires_at,
      metadata      = user_integration_tokens.metadata || EXCLUDED.metadata
    `,
    [
      input.userId,
      input.provider,
      input.accountId,
      input.accountEmail ?? null,
      input.accountLabel ?? null,
      input.scope ?? null,
      access.ciphertext, access.iv, access.tag,
      refresh?.ciphertext ?? null, refresh?.iv ?? null, refresh?.tag ?? null,
      input.expiresAt ?? null,
      input.metadata ?? {},
    ],
  );
}

/** Look up the active token for a single (user, provider, account). */
export async function getToken(args: {
  userId: string;
  provider: ConnectorId;
  accountId: string;
}): Promise<StoredToken | null> {
  const { rows } = await pool.query(
    `SELECT user_id, provider, account_id, account_email, account_label, scope,
            access_token, access_iv, access_tag,
            refresh_token, refresh_iv, refresh_tag,
            expires_at, metadata
     FROM user_integration_tokens
     WHERE user_id = $1 AND provider = $2 AND account_id = $3`,
    [args.userId, args.provider, args.accountId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];

  const accessToken = decrypt({ ciphertext: r.access_token, iv: r.access_iv, tag: r.access_tag });
  let refreshToken: string | undefined;
  if (r.refresh_token && r.refresh_iv && r.refresh_tag) {
    refreshToken = decrypt({ ciphertext: r.refresh_token, iv: r.refresh_iv, tag: r.refresh_tag });
  }

  return {
    userId: r.user_id,
    provider: r.provider as ConnectorId,
    accountId: r.account_id,
    accountEmail: r.account_email ?? undefined,
    accountLabel: r.account_label ?? undefined,
    scope: r.scope ?? undefined,
    accessToken,
    refreshToken,
    expiresAt: r.expires_at ?? undefined,
    metadata: r.metadata ?? {},
  };
}

/** List all accounts the user has connected at a given provider. */
export async function listAccounts(args: {
  userId: string;
  provider: ConnectorId;
}): Promise<ConnectedAccount[]> {
  const { rows } = await pool.query(
    `SELECT account_id, account_email, account_label, scope, created_at
     FROM user_integration_tokens
     WHERE user_id = $1 AND provider = $2
     ORDER BY created_at DESC`,
    [args.userId, args.provider],
  );
  return (rows as Array<{
    account_id: string;
    account_email: string | null;
    account_label: string | null;
    scope: string | null;
    created_at: Date;
  }>).map((r) => ({
    accountId: r.account_id,
    email: r.account_email ?? undefined,
    label: r.account_label ?? undefined,
    scope: r.scope ?? undefined,
    connectedAt: new Date(r.created_at).toISOString(),
  }));
}

/** Delete a connected account's token row. */
export async function deleteToken(args: {
  userId: string;
  provider: ConnectorId;
  accountId: string;
}): Promise<void> {
  await pool.query(
    `DELETE FROM user_integration_tokens
     WHERE user_id = $1 AND provider = $2 AND account_id = $3`,
    [args.userId, args.provider, args.accountId],
  );
}

/**
 * Update only the access token + expiry for a refresh-rotation cycle.
 * Refresh token is preserved unless the provider rotates it (then pass the
 * new value in `newRefreshToken`).
 */
export async function refreshStoredToken(args: {
  userId: string;
  provider: ConnectorId;
  accountId: string;
  newAccessToken: string;
  newRefreshToken?: string;
  expiresAt?: Date;
}): Promise<void> {
  const access = encrypt(args.newAccessToken);
  const refresh = args.newRefreshToken ? encrypt(args.newRefreshToken) : null;

  if (refresh) {
    await pool.query(
      `UPDATE user_integration_tokens
       SET access_token = $4, access_iv = $5, access_tag = $6,
           refresh_token = $7, refresh_iv = $8, refresh_tag = $9,
           expires_at = $10
       WHERE user_id = $1 AND provider = $2 AND account_id = $3`,
      [
        args.userId, args.provider, args.accountId,
        access.ciphertext, access.iv, access.tag,
        refresh.ciphertext, refresh.iv, refresh.tag,
        args.expiresAt ?? null,
      ],
    );
  } else {
    await pool.query(
      `UPDATE user_integration_tokens
       SET access_token = $4, access_iv = $5, access_tag = $6,
           expires_at = $7
       WHERE user_id = $1 AND provider = $2 AND account_id = $3`,
      [
        args.userId, args.provider, args.accountId,
        access.ciphertext, access.iv, access.tag,
        args.expiresAt ?? null,
      ],
    );
  }
}
