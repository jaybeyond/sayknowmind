import { headers } from "next/headers";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

function extractBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** MCP keys are stored as SHA-256(token) hex (migration 062), never plaintext. */
function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getUserIdFromMcpKey(token: string): Promise<string | null> {
  if (!token.startsWith("sk-mcp-")) return null;

  try {
    const result = await pool.query(
      `SELECT user_id FROM user_mcp_keys WHERE api_key_hash = $1`,
      [hashApiKey(token)],
    );
    return (result.rows[0]?.user_id as string | undefined) ?? null;
  } catch (err) {
    console.error("[session-helper] MCP key lookup failed:", err);
    return null;
  }
}

export async function getUserIdFromRequest(): Promise<string | null> {
  const requestHeaders = await headers();

  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session?.user?.id) return session.user.id;
  } catch {
    // Fall through to MCP API-key auth below.
  }

  const bearerToken = extractBearerToken(requestHeaders.get("authorization"));
  if (!bearerToken) return null;

  return await getUserIdFromMcpKey(bearerToken);
}
