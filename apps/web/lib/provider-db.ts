/**
 * Per-user provider config stored in PostgreSQL with AES-256-GCM encryption.
 * API keys are encrypted using the user's derived key from lib/encryption.ts.
 */

import { pool } from "@/lib/db";
import { encryptForUser, decryptForUser } from "@/lib/encryption";
import type { ProviderEntry } from "@/lib/provider-config";

const MASK_SENTINEL = "••••••";

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_provider_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      provider_id VARCHAR(50) NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      model VARCHAR(200) NOT NULL DEFAULT '',
      base_url VARCHAR(500) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT false,
      extra_fields JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT upc_user_provider UNIQUE (user_id, provider_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_upc_user ON user_provider_configs(user_id)`);
  tableEnsured = true;
}

/** Check if a key value is a masked placeholder (should not be saved) */
export function isMaskedKey(key: string): boolean {
  return key.includes("...") || key.includes(MASK_SENTINEL);
}

/** Mask an API key for display (first 6 + last 4 chars) */
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return MASK_SENTINEL;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/**
 * Save provider configs for a user. Encrypts API keys before storage.
 * Masked keys are skipped (existing encrypted value is preserved).
 */
export async function saveUserProviders(
  userId: string,
  providers: Array<{
    id: string;
    apiKey: string;
    model: string;
    baseUrl: string;
    isActive?: boolean;
    extraFields?: Record<string, unknown>;
  }>,
): Promise<void> {
  await ensureTable();

  // First, clear active flag for all user providers
  await pool.query(
    `UPDATE user_provider_configs SET is_active = false WHERE user_id = $1`,
    [userId],
  );

  for (const p of providers) {
    if (!p.id || !p.baseUrl) continue;

    // If the key is masked, update everything except the key
    if (isMaskedKey(p.apiKey)) {
      await pool.query(
        `UPDATE user_provider_configs
         SET model = $1, base_url = $2, is_active = $3, extra_fields = $4, updated_at = NOW()
         WHERE user_id = $5 AND provider_id = $6`,
        [p.model, p.baseUrl, p.isActive ?? false, JSON.stringify(p.extraFields ?? {}), userId, p.id],
      );
      continue;
    }

    // Encrypt the API key
    const encryptedKey = encryptForUser(userId, p.apiKey);

    await pool.query(
      `INSERT INTO user_provider_configs (user_id, provider_id, encrypted_api_key, model, base_url, is_active, extra_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, provider_id)
       DO UPDATE SET encrypted_api_key = $3, model = $4, base_url = $5, is_active = $6, extra_fields = $7, updated_at = NOW()`,
      [userId, p.id, encryptedKey, p.model, p.baseUrl, p.isActive ?? false, JSON.stringify(p.extraFields ?? {})],
    );
  }
}

/**
 * Get all provider configs for a user. Decrypts API keys.
 * Returns active provider first, then others.
 */
export async function getUserProviders(userId: string): Promise<ProviderEntry[]> {
  await ensureTable();
  const result = await pool.query(
    `SELECT provider_id, encrypted_api_key, model, base_url, is_active, extra_fields
     FROM user_provider_configs
     WHERE user_id = $1
     ORDER BY is_active DESC, updated_at DESC`,
    [userId],
  );

  const entries: ProviderEntry[] = [];
  for (const row of result.rows) {
    try {
      const apiKey = decryptForUser(userId, row.encrypted_api_key as string);
      entries.push({
        id: row.provider_id,
        apiKey,
        model: row.model,
        baseUrl: row.base_url,
      });
    } catch (err) {
      console.error(`[provider-db] Failed to decrypt key for ${row.provider_id}:`, err);
      // Skip corrupted entries
    }
  }

  return entries;
}

/**
 * Get provider configs with masked keys (for GET responses).
 */
export async function getUserProvidersMasked(
  userId: string,
): Promise<Array<{ id: string; apiKey: string; model: string; baseUrl: string; isActive: boolean; extraFields: Record<string, unknown> }>> {
  await ensureTable();
  const result = await pool.query(
    `SELECT provider_id, encrypted_api_key, model, base_url, is_active, extra_fields
     FROM user_provider_configs
     WHERE user_id = $1
     ORDER BY is_active DESC, updated_at DESC`,
    [userId],
  );

  return result.rows.map((row: Record<string, unknown>) => {
    let maskedKey = MASK_SENTINEL;
    try {
      const apiKey = decryptForUser(userId, row.encrypted_api_key as string);
      maskedKey = maskApiKey(apiKey);
    } catch {
      // Can't decrypt — show generic mask
    }
    return {
      id: row.provider_id,
      apiKey: maskedKey,
      model: row.model,
      baseUrl: row.base_url,
      isActive: row.is_active,
      extraFields: row.extra_fields ?? {},
    };
  });
}

/**
 * Delete a specific provider config for a user.
 */
export async function deleteUserProvider(userId: string, providerId: string): Promise<void> {
  await pool.query(
    `DELETE FROM user_provider_configs WHERE user_id = $1 AND provider_id = $2`,
    [userId, providerId],
  );
}
