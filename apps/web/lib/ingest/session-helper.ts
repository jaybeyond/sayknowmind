import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

function extractBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function getUserIdFromMcpKey(token: string): Promise<string | null> {
  if (!token.startsWith("sk-mcp-")) return null;

  try {
    const result = await pool.query(
      `SELECT user_id FROM user_mcp_keys WHERE api_key = $1`,
      [token],
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
