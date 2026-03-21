import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    `postgres://${process.env.POSTGRES_USER ?? "postgres"}:${process.env.POSTGRES_PASSWORD ?? "changeme-in-production"}@localhost:${process.env.POSTGRES_PORT ?? "5432"}/sayknowmind`,
});

export const auth = betterAuth({
  database: pool,

  // Email & password authentication
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
  },

  // Session management: 24h expiry with auto-renewal
  session: {
    expiresIn: 60 * 60 * 24, // 24 hours
    updateAge: 60 * 60 * 12, // refresh after 12 hours
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5-minute cache
    },
  },

  // Rate limiting for account lockout
  rateLimit: {
    enabled: true,
    window: 60 * 15, // 15-minute window
    max: 100,
    storage: "memory",
    customRules: {
      "/sign-in/email": {
        window: 60 * 15, // 15-minute window
        max: 5, // 5 consecutive failures → locked for 15 min
      },
      "/sign-up/email": {
        window: 60,
        max: 3,
      },
    },
  },

  plugins: [nextCookies()],

  trustedOrigins: process.env.TRUSTED_ORIGINS
    ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:3001"],
});

export type Auth = typeof auth;
