import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
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

export async function POST(req: Request) {
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
      // Existing local user → rotate the shadow password to a known value, then
      // sign in normally so the session.create.before hook (activeOrganizationId)
      // and cookie handling run exactly as for a real password login.
      const ctx = await auth.$context;
      const hashed = await ctx.password.hash(localPassword);
      await ctx.internalAdapter.updatePassword(existing.rows[0].id as string, hashed);
      authResponse = await auth.api.signInEmail({
        body: { email, password: localPassword, rememberMe },
        headers: reqHeaders,
        asResponse: true,
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
