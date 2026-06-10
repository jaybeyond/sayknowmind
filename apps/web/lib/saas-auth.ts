// SayKnowWork SaaS is the source of truth for credentials. We delegate the
// email/password check to its /v1/auth/login endpoint and use the result only
// to decide whether to mint a local better-auth session (see
// app/api/auth/external-login/route.ts). We do NOT store the SaaS tokens or
// build a separate member DB — account/workspace/role live in SaaS.
//
// Integration guide: sayknowwork-server/docs/auth-integration.md

const SAAS_BASE = (
  process.env.SAYKNOWWORK_AUTH_URL || "https://sayknowwork.ai-ops.click"
).replace(/\/+$/, "");

export interface SaasUser {
  id: string;
  email: string;
  displayName?: string;
  emailVerified?: boolean;
  locale?: string;
  status?: string;
}

export interface SaasTenant {
  id: string;
  slug?: string;
  name?: string;
  role?: string;
}

export type SaasLoginResult =
  | {
      ok: true;
      user: SaasUser;
      tenant?: SaasTenant;
      tenants?: SaasTenant[];
    }
  | {
      ok: false;
      status: number;
      // A code the login UI can map to an i18n string. We reuse better-auth's
      // INVALID_EMAIL_OR_PASSWORD for 401 so existing translations apply.
      code: string;
      message?: string;
    };

/**
 * Verify credentials against SayKnowWork SaaS.
 * `identifier` may be a 工号 or an email. The SaaS treats the `email` and
 * `loginId` fields differently: `loginId` is always run through its
 * synthesizeEmail() (→ `<slug>@sayknow.local`), so an email put there would
 * never match a real-email account. We therefore route an email-looking value
 * to the `email` field and everything else (employee numbers) to `loginId`.
 */
export async function loginToSaas(
  identifier: string,
  password: string,
): Promise<SaasLoginResult> {
  const isEmail = identifier.includes("@");
  const body = isEmail
    ? { email: identifier, password }
    : { loginId: identifier, password };
  let res: Response;
  try {
    res = await fetch(`${SAAS_BASE}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Server-to-server; never cache an auth response.
      cache: "no-store",
    });
  } catch (err) {
    console.error("[saas-auth] login request failed", err);
    return {
      ok: false,
      status: 502,
      code: "SAAS_UNREACHABLE",
      message: "Authentication service is unreachable",
    };
  }

  let resBody: unknown = null;
  try {
    resBody = await res.json();
  } catch {
    // Non-JSON body — fall through to status-based handling below.
  }

  if (res.ok) {
    const data = resBody as {
      user?: SaasUser;
      tenant?: SaasTenant;
      tenants?: SaasTenant[];
    } | null;
    if (!data?.user?.email) {
      console.error("[saas-auth] login succeeded but response lacked a user", resBody);
      return { ok: false, status: 502, code: "SAAS_BAD_RESPONSE" };
    }
    return {
      ok: true,
      user: data.user,
      tenant: data.tenant,
      tenants: data.tenants,
    };
  }

  const errBody = (resBody ?? {}) as { message?: string; error?: string; code?: string };
  // 401 = bad credentials, 403 = account not active (pending_review/suspended).
  const code =
    res.status === 401
      ? "INVALID_EMAIL_OR_PASSWORD"
      : res.status === 403
        ? "ACCOUNT_NOT_ACTIVE"
        : errBody.code || "SAAS_ERROR";
  return {
    ok: false,
    status: res.status,
    code,
    message: errBody.message || errBody.error,
  };
}
