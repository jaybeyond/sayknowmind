import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    `postgres://${process.env.POSTGRES_USER ?? "postgres"}:${process.env.POSTGRES_PASSWORD ?? "changeme-in-production"}@localhost:${process.env.POSTGRES_PORT ?? "5432"}/sayknowmind`,
});

export const auth = betterAuth({
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

  plugins: [nextCookies(), jwt()],

  trustedOrigins: process.env.TRUSTED_ORIGINS
    ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:3001"],
});

export type Auth = typeof auth;
