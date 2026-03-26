import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

let _auth: ReturnType<typeof betterAuth> | null = null;

function getPool() {
  // Dynamic require to avoid bundling issues in standalone mode
  const { Pool } = require("pg") as typeof import("pg");
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "postgres"}:${process.env.POSTGRES_PASSWORD ?? "changeme-in-production"}@localhost:${process.env.POSTGRES_PORT ?? "5432"}/sayknowmind`,
  });
}

function createAuth() {
  if (_auth) return _auth;
  const pool = getPool();
  _auth = betterAuth({
    database: pool,
    secret: process.env.BETTER_AUTH_SECRET || "build-time-placeholder-do-not-use",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",

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
      storage: "database",
      customRules: {
        "/sign-in/email": {
          window: 60 * 15, // 15-minute window
          max: 20, // 20 attempts per 15 min
        },
        "/sign-up/email": {
          window: 60,
          max: 10,
        },
      },
    },

    plugins: [nextCookies()],

    trustedOrigins: process.env.TRUSTED_ORIGINS
      ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
      : ["http://localhost:3000", "http://localhost:3001"],
  });
  return _auth;
}

// Lazy getter — auth is only created on first access
export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop) {
    return (createAuth() as any)[prop];
  },
});

export type Auth = typeof auth;
