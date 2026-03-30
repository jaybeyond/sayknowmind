import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  const result = await pool.query(
    `SELECT role FROM "user" WHERE id = $1`,
    [session.user.id],
  );
  if (result.rowCount === 0 || result.rows[0].role !== "admin") {
    throw new Error("Forbidden");
  }
}
