/**
 * Two product editions share this codebase, distinguished by NEXT_PUBLIC_AUTH_MODE:
 *
 *   "saas"  — Enterprise edition (EC2 / sayknowmind.ypai.click). Login is
 *             delegated to SayKnowWork SaaS; local sign-up/password are disabled.
 *   "local" — Open edition (Railway). Built-in better-auth email/password login
 *             with self-service sign-up and password change.
 *
 * Default is "saas" so the enterprise build needs no extra config; the open
 * build sets NEXT_PUBLIC_AUTH_MODE=local (build arg + runtime env). The var is
 * NEXT_PUBLIC_* so it's available both in client components (baked at build) and
 * server routes (read at runtime) — keep it consistent per deployment.
 */
export type AuthMode = "saas" | "local";

export const AUTH_MODE: AuthMode =
  process.env.NEXT_PUBLIC_AUTH_MODE === "local" ? "local" : "saas";

/** True for the Enterprise edition (login via SayKnowWork SaaS). */
export const isSaasAuth = AUTH_MODE === "saas";
