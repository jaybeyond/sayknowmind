import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;

function getPool() {
  const { Pool } = require("pg") as typeof import("pg");
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "postgres"}:${process.env.POSTGRES_PASSWORD ?? "changeme-in-production"}@localhost:${process.env.POSTGRES_PORT ?? "5432"}/sayknowmind`,
  });
}

export function getAuth() {
  if (_auth) return _auth;
  const pool = getPool();
  _auth = betterAuth({
    database: pool,
    secret: process.env.BETTER_AUTH_SECRET || "build-time-placeholder-do-not-use",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
    },

    session: {
      expiresIn: 60 * 60 * 24,
      updateAge: 60 * 60 * 12,
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

    plugins: [nextCookies()],

    trustedOrigins: process.env.TRUSTED_ORIGINS
      ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
      : ["http://localhost:3000", "http://localhost:3001"],
  });
  return _auth;
}

// For backward compat — modules that do `import { auth } from "@/lib/auth"`
export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop) {
    const instance = getAuth();
    const value = instance[prop];
    // Bind methods so `this` works correctly
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type Auth = typeof auth;
