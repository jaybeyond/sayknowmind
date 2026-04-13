import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { randomBytes } from "crypto";

/** POST /api/user/mcp-key — Generate a new MCP API key for the current user */
export async function POST() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = `sk-mcp-${randomBytes(32).toString("hex")}`;

  // Store in user metadata (upsert)
  await pool.query(
    `UPDATE "user" SET "updatedAt" = NOW() WHERE id = $1`,
    [userId],
  );

  // Store key in a dedicated table or metadata
  await pool.query(
    `INSERT INTO user_mcp_keys (user_id, api_key, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET api_key = $2, created_at = NOW()`,
    [userId, apiKey],
  );

  return NextResponse.json({ apiKey });
}

/** GET /api/user/mcp-key — Get current MCP API key */
export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pool.query(
    `SELECT api_key FROM user_mcp_keys WHERE user_id = $1`,
    [userId],
  );

  return NextResponse.json({
    apiKey: (result.rows[0] as Record<string, unknown>)?.api_key ?? null,
  });
}
