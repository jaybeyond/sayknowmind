import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pool } from "@/lib/db";

const AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "build-placeholder";

export const auth = betterAuth({
  database: pool,
  secret: AUTH_SECRET,
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

export type Auth = typeof auth;
