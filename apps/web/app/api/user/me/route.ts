import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** GET /api/user/me — Get current user profile */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pool.query(
    `SELECT id, name, email, image, locale, "createdAt" FROM "user" WHERE id = $1`,
    [session.user.id],
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}

/** PATCH /api/user/me — Update current user profile */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const updates: string[] = [];
  const values: string[] = [];
  let paramIdx = 1;

  if (typeof body.name === "string" && body.name.trim().length > 0) {
    updates.push(`name = $${paramIdx}`);
    values.push(body.name.trim().slice(0, 100));
    paramIdx++;
  }

  const validLocales = ["en", "ko", "ja", "zh"];
  if (typeof body.locale === "string" && validLocales.includes(body.locale)) {
    updates.push(`locale = $${paramIdx}`);
    values.push(body.locale);
    paramIdx++;
  }

  if (typeof body.email === "string" && body.email.includes("@")) {
    // Check email uniqueness
    const existing = await pool.query(
      `SELECT id FROM "user" WHERE email = $1 AND id != $2`,
      [body.email.trim(), session.user.id],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    updates.push(`email = $${paramIdx}`);
    values.push(body.email.trim().toLowerCase());
    paramIdx++;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.push(`"updatedAt" = NOW()`);
  values.push(session.user.id);

  const result = await pool.query(
    `UPDATE "user" SET ${updates.join(", ")} WHERE id = $${paramIdx} RETURNING id, name, email, image, locale`,
    values,
  );

  return NextResponse.json(result.rows[0]);
}
