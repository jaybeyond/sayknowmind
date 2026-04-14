/**
 * Daily AI usage rate limiter.
 * Users without their own API keys are limited to FREE_DAILY_LIMIT calls/day.
 * Users with configured provider keys get unlimited access.
 */

import { pool } from "@/lib/db";

/** Free tier: max AI calls per day when using server API key */
const FREE_DAILY_LIMIT = 10;

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_daily_usage (
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
      ai_call_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, usage_date)
    )
  `);
  tableEnsured = true;
}

/**
 * Check if a user has their own provider keys configured.
 */
async function hasOwnApiKeys(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM user_provider_configs WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Get today's usage count for a user.
 */
async function getDailyCount(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT ai_call_count FROM user_daily_usage
     WHERE user_id = $1 AND usage_date = CURRENT_DATE`,
    [userId],
  );
  return (result.rows[0]?.ai_call_count as number) ?? 0;
}

/**
 * Increment the daily usage counter. Returns the new count.
 */
async function incrementDailyCount(userId: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO user_daily_usage (user_id, usage_date, ai_call_count, updated_at)
     VALUES ($1, CURRENT_DATE, 1, NOW())
     ON CONFLICT (user_id, usage_date)
     DO UPDATE SET ai_call_count = user_daily_usage.ai_call_count + 1, updated_at = NOW()
     RETURNING ai_call_count`,
    [userId],
  );
  return result.rows[0].ai_call_count as number;
}

export interface UsageCheckResult {
  allowed: boolean;
  hasOwnKeys: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Check if a user can make an AI call. If allowed, increments the counter.
 * Users with own API keys always pass. Free tier users are limited.
 */
export async function checkAndIncrementUsage(userId: string): Promise<UsageCheckResult> {
  await ensureTable();
  const ownKeys = await hasOwnApiKeys(userId);

  if (ownKeys) {
    return { allowed: true, hasOwnKeys: true, used: 0, limit: 0, remaining: Infinity };
  }

  const currentCount = await getDailyCount(userId);

  if (currentCount >= FREE_DAILY_LIMIT) {
    return {
      allowed: false,
      hasOwnKeys: false,
      used: currentCount,
      limit: FREE_DAILY_LIMIT,
      remaining: 0,
    };
  }

  const newCount = await incrementDailyCount(userId);

  return {
    allowed: true,
    hasOwnKeys: false,
    used: newCount,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - newCount),
  };
}

/**
 * Get current usage status without incrementing.
 */
export async function getUsageStatus(userId: string): Promise<UsageCheckResult> {
  await ensureTable();
  const ownKeys = await hasOwnApiKeys(userId);

  if (ownKeys) {
    return { allowed: true, hasOwnKeys: true, used: 0, limit: 0, remaining: Infinity };
  }

  const currentCount = await getDailyCount(userId);

  return {
    allowed: currentCount < FREE_DAILY_LIMIT,
    hasOwnKeys: false,
    used: currentCount,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - currentCount),
  };
}
