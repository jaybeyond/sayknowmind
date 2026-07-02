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

function originMatches(candidate: string): boolean {
  for (const trusted of TRUSTED_ORIGINS) {
    // Exact match covers custom app schemes (tauri://localhost, sayknowmind://).
    if (candidate === trusted) return true;
    // Origin-level match for special schemes (http/https/ws/…) so a path-bearing
    // Referer still matches. Custom schemes parse to the opaque origin "null",
    // which is NOT distinguishing — every custom-scheme URL shares it — so a
    // "null" === "null" comparison would trust ANY custom-scheme Origin
    // (e.g. `Origin: evil://x`). Skip opaque origins; they're handled by the
    // exact match above only.
    let cOrigin: string;
    let tOrigin: string;
    try {
      cOrigin = new URL(candidate).origin;
      tOrigin = new URL(trusted).origin;
    } catch {
      continue; // unparseable — exact match already tried
    }
    if (cOrigin === "null" || tOrigin === "null") continue;
    if (cOrigin === tOrigin) return true;
  }
  return false;
}

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
  // No Origin AND no Referer → a non-browser client (SDK, curl, native/Flutter
  // app). Browsers ALWAYS send Origin on cross-origin POSTs, so a CSRF attacker
  // cannot produce this state from a victim's browser; only direct API clients
  // can, and those aren't subject to CSRF. Allow it so credential-only clients
  // aren't 403'd before their credentials are even read.
  if (!candidate) return true;

  return originMatches(candidate);
}

// ---------------------------------------------------------------------------
// AUTH-2: Serialised shadow-password rotation
// ---------------------------------------------------------------------------
// Concurrent logins for the same user both hit the "rotate password → sign in"
// path and race: A writes passwordA, B writes passwordB, A tries to sign in
// with passwordA but the DB now holds passwordB → SESSION_MINT_FAILED 500.
//
// Earlier this used a PostgreSQL session-level advisory lock held on a pooled
// client across the write AND signInEmail. That deadlocked the whole pool:
// signInEmail needs its own pool connection, so N concurrent same-user logins
// pinned N connections waiting on the lock and the winner could never get a
// connection to sign in (pg pool default max=10, wait-forever). See CODE-REVIEW
// C2.
//
// Fix: serialise with an in-process, per-user async mutex that holds NO database
// connection while waiting. updatePassword/signInEmail acquire and release pool
// connections normally, so there is no connection starvation. Cross-instance
// caveat: this serialises within one server process; two processes racing the
// same user can still (rarely) produce a retriable SESSION_MINT_FAILED, which is
// vastly preferable to a permanent whole-pool deadlock.

const userLoginChains = new Map<string, Promise<unknown>>();

/** Run `fn` after any in-flight login for the same userId completes (per-process). */
function withUserLoginLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userLoginChains.get(userId) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run after prev settles (success OR failure)
  // Tail swallows rejections so one failed login doesn't break the chain; the
  // caller still observes `run`'s rejection.
  const tail = run.catch(() => {});
  userLoginChains.set(userId, tail);
  // Drop the map entry once this is the last queued op, to bound memory.
  tail.finally(() => {
    if (userLoginChains.get(userId) === tail) userLoginChains.delete(userId);
  });
  return run;
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
      // ---- AUTH-2: serialised rotation via in-process per-user mutex ----
      // Existing local user → rotate the shadow password to a known value, then
      // sign in normally so the session.create.before hook (activeOrganizationId)
      // and cookie handling run exactly as for a real password login.
      //
      // withUserLoginLock() serialises concurrent same-user logins so the
      // "write password X → sign in with X" sequence is atomic w.r.t. other
      // requests, WITHOUT holding a pooled DB connection while waiting (which is
      // what deadlocked the pool before — see CODE-REVIEW C2). The password hash
      // is computed OUTSIDE the critical section since it touches no DB state.
      const userId = existing.rows[0].id as string;
      const ctx = await auth.$context;
      const hashed = await ctx.password.hash(localPassword);

      authResponse = await withUserLoginLock(userId, async () => {
        await ctx.internalAdapter.updatePassword(userId, hashed);
        return auth.api.signInEmail({
          body: { email, password: localPassword, rememberMe },
          headers: reqHeaders,
          asResponse: true,
        });
      });
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
