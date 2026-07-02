import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth, TRUSTED_ORIGINS } from "@/lib/auth";
import { pool } from "@/lib/db";
import { loginToSaas } from "@/lib/saas-auth";

// Login is delegated to SayKnowWork SaaS, which owns credentials and
// workspaces. On success we map the SaaS user onto a local better-auth user
// (provisioning one on first login) and mint a normal better-auth session, so
// every downstream piece — middleware, org context, ACL — keeps working
// unchanged. The local password is an opaque shadow we rotate on every login:
// SaaS is the only real credential, so the SaaS password's length/format never
// has to satisfy better-auth's local rules.

/** A throwaway local credential that comfortably satisfies better-auth's 8–128 rule. */
function freshLocalPassword(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

function copySetCookies(from: Response, to: NextResponse) {
  for (const cookie of from.headers.getSetCookie()) {
    to.headers.append("set-cookie", cookie);
  }
}

// ---------------------------------------------------------------------------
// AUTH-3: CSRF / Origin allow-list
// ---------------------------------------------------------------------------
// better-auth's built-in CSRF guard only covers its own route handler.  This
// hand-written route must enforce the same policy manually.  We check the
// Origin header (always sent by browsers on cross-origin POSTs) and fall back
// to Referer.  Requests with no recognisable origin are rejected.

function originTrusted(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  // Extract the usable candidate: prefer Origin (authoritative), fall back to
  // the origin portion of Referer (which browsers include even for same-site).
  let candidate = origin;
  if (!candidate && referer) {
    try {
      candidate = new URL(referer).origin;
    } catch {
      return false;
    }
  }
  if (!candidate) return false;

  for (const trusted of TRUSTED_ORIGINS) {
    // Exact match (covers non-standard schemes like tauri:// or sayknowmind://)
    if (candidate === trusted) return true;
    // Origin-level match: strip path from both sides and compare
    try {
      if (new URL(candidate).origin === new URL(trusted).origin) return true;
    } catch {
      // Non-parseable scheme — already handled by exact match above
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// AUTH-2: Serialised shadow-password rotation
// ---------------------------------------------------------------------------
// Concurrent logins for the same user both hit the "rotate password → sign in"
// path and race: A writes passwordA, B writes passwordB, A tries to sign in
// with passwordA but the DB now holds passwordB → SESSION_MINT_FAILED 500.
//
// Fix: acquire a PostgreSQL session-level advisory lock keyed on the user ID
// before the rotation.  The lock spans both the write AND the sign-in call, so
// the next concurrent request can only start its rotation after the current one
// has successfully signed in and released the lock.

/** Maps a UUID string to two deterministic int4 values for pg_advisory_lock(int,int). */
function userLockKey(userId: string): [number, number] {
  // Two independent DJB2 hashes over the UUID string.  Using the two-int4
  // overload of pg_advisory_lock avoids BigInt (requires ES2020+).
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < userId.length; i++) {
    const c = userId.charCodeAt(i);
    h1 = Math.imul(h1, 33) ^ c;
    h2 = Math.imul(h2, 33) ^ c;
  }
  // Bitwise ops produce signed int32; pass as-is (pg accepts signed int4).
  return [h1, h2];
}

export async function POST(req: Request) {
  // ---- AUTH-3: reject cross-site requests ----
  if (!originTrusted(req)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  }

  let payload: { loginId?: string; email?: string; password?: string; rememberMe?: boolean };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  }

  const loginId = (payload.loginId || payload.email || "").trim();
  const password = payload.password || "";
  const rememberMe = payload.rememberMe ?? true;
  if (!loginId || !password) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  }

  // 1) SaaS is the source of truth for the credential check.
  const result = await loginToSaas(loginId, password);
  if (!result.ok) {
    return NextResponse.json(
      { code: result.code, message: result.message },
      { status: result.status },
    );
  }

  const { user: saasUser, tenant } = result;
  const email = saasUser.email;
  const displayName = saasUser.displayName?.trim() || email.split("@")[0];
  const reqHeaders = await headers();
  const localPassword = freshLocalPassword();

  try {
    const existing = await pool.query(
      `SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
      [email],
    );

    let authResponse: Response;

    if (existing.rows.length === 0) {
      // First SaaS login → provision a local user. autoSignIn:true sets the
      // session cookie and runs the user.create.after hook (personal org).
      authResponse = await auth.api.signUpEmail({
        body: { email, password: localPassword, name: displayName },
        headers: reqHeaders,
        asResponse: true,
      });
    } else {
      // ---- AUTH-2: serialised rotation via pg_advisory_lock ----
      // Existing local user → rotate the shadow password to a known value, then
      // sign in normally so the session.create.before hook (activeOrganizationId)
      // and cookie handling run exactly as for a real password login.
      //
      // The advisory lock serialises concurrent logins for the same user so the
      // "write password X → sign in with X" sequence is atomic from the
      // perspective of other requests.  pg_advisory_lock is session-level (not
      // transaction-level), so it spans the updatePassword call AND the
      // signInEmail call before being released.
      const userId = existing.rows[0].id as string;
      const lockKey = userLockKey(userId);
      const client = await pool.connect();
      let lockAcquired = false;
      try {
        await client.query(`SELECT pg_advisory_lock($1::int, $2::int)`, lockKey);
        lockAcquired = true;

        const ctx = await auth.$context;
        const hashed = await ctx.password.hash(localPassword);
        await ctx.internalAdapter.updatePassword(userId, hashed);

        authResponse = await auth.api.signInEmail({
          body: { email, password: localPassword, rememberMe },
          headers: reqHeaders,
          asResponse: true,
        });
      } finally {
        if (lockAcquired) {
          await client
            .query(`SELECT pg_advisory_unlock($1::int, $2::int)`, lockKey)
            .catch((e: unknown) => console.error("[external-login] advisory unlock failed", e));
        }
        client.release();
      }
    }

    if (!authResponse.ok) {
      console.error(
        "[external-login] better-auth session mint failed",
        authResponse.status,
        await authResponse.text().catch(() => ""),
      );
      return NextResponse.json({ code: "SESSION_MINT_FAILED" }, { status: 500 });
    }

    const res = NextResponse.json({
      ok: true,
      user: { email, displayName },
      tenant: tenant ? { id: tenant.id, name: tenant.name, role: tenant.role } : null,
    });
    copySetCookies(authResponse, res);
    return res;
  } catch (err) {
    if (err instanceof APIError) {
      console.error("[external-login] better-auth APIError", err.status, err.message);
      return NextResponse.json(
        { code: "SESSION_MINT_FAILED", message: err.message },
        { status: 500 },
      );
    }
    console.error("[external-login] unexpected error", err);
    return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
