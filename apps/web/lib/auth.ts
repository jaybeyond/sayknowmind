import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { pool } from "@/lib/db";

function resolveAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  // A placeholder is only acceptable during `next build` or in development.
  // At production runtime a missing secret means every session token would be
  // signed with a publicly-known string and could be forged, so fail fast.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuild) {
    throw new Error(
      "BETTER_AUTH_SECRET is required in production — refusing to start with a placeholder signing key",
    );
  }
  return "build-placeholder";
}

const AUTH_SECRET = resolveAuthSecret();

// Team feature, Phase 1 — every user owns a "personal" organization, so the
// team model always has an org context to fall back to. These hooks keep that
// invariant true without depending on deploy/migration ordering: a failure
// here is logged but never blocks sign-up or sign-in.

/** Create a personal organization the first time a user is created. */
async function createPersonalOrg(user: { id: string; name?: string | null; email: string }) {
  const orgId = crypto.randomUUID().replace(/-/g, "");
  const memberId = crypto.randomUUID().replace(/-/g, "");
  const displayName = (user.name?.trim() || user.email.split("@")[0]) + " (Personal)";
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())
     ON CONFLICT (slug) DO NOTHING`,
    [orgId, displayName, "personal-" + user.id],
  );
  await pool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     SELECT $1, o.id, $2, 'owner', NOW()
       FROM organization o
      WHERE o.slug = $3
     ON CONFLICT ("organizationId", "userId") DO NOTHING`,
    [memberId, user.id, "personal-" + user.id],
  );
}

/** Resolve the organization a new session should start active in. */
async function resolveActiveOrg(userId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT "organizationId" FROM member
      WHERE "userId" = $1 ORDER BY "createdAt" ASC LIMIT 1`,
    [userId],
  );
  return (result.rows[0]?.organizationId as string | undefined) ?? null;
}

export const auth = betterAuth({
  database: pool,
  secret: AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5400",

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
  },

  session: {
    // 30-day session so "keep me signed in" (rememberMe) actually keeps the user
    // logged in long-term — they rarely need to re-enter their password. When
    // rememberMe is unchecked the cookie is session-only regardless of this.
    expiresIn: 60 * 60 * 24 * 30,
    // Refresh the expiry once a day of activity, sliding the 30-day window.
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  rateLimit: {
    enabled: true,
    window: 60 * 15,
    max: 100,
    storage: "database",
    customRules: {
      "/sign-in/email": {
        window: 60 * 15,
        max: 20,
      },
      "/sign-up/email": {
        window: 60,
        max: 10,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await createPersonalOrg(user);
          } catch (err) {
            console.error("[auth] failed to create personal organization", err);
          }
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          try {
            return {
              data: {
                ...session,
                activeOrganizationId: await resolveActiveOrg(session.userId),
              },
            };
          } catch (err) {
            console.error("[auth] failed to resolve active organization", err);
            return undefined;
          }
        },
      },
    },
  },

  // `organization` is the unit of a "team": members share a knowledge pool.
  // The nested `teams` sub-feature is intentionally left disabled.
  // `nextCookies()` must stay last in the plugin list.
  plugins: [organization(), nextCookies()],

  trustedOrigins: process.env.TRUSTED_ORIGINS
    ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : [
        "http://localhost:5400",
        "http://localhost:5401",
        "http://127.0.0.1:3457",
        "http://localhost:3457",
        "tauri://localhost",
      ],
});

export type Auth = typeof auth;
