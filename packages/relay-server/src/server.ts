/**
 * Relay server app — Hono routes with auth middleware.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Pool } from "pg";
import { verifyRelayToken, type RelayTokenPayload } from "./auth/relay-token.js";
import { pushRoute } from "./routes/push.js";
import { pullRoute } from "./routes/pull.js";
import { ackRoute } from "./routes/ack.js";
import { statusRoute } from "./routes/status.js";
import { telegramProxyRoute } from "./routes/telegram-proxy.js";

type Env = {
  Variables: {
    pool: Pool;
    tokenPayload: RelayTokenPayload;
  };
};

export function createRelayApp(pool: Pool) {
  const app = new Hono<Env>();

  app.use("*", cors());

  // Health check — no auth
  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "sayknowmind-relay", uptime: process.uptime() });
  });

  // Auth middleware for /relay/* routes
  app.use("/relay/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);
    const payload = verifyRelayToken(token);
    if (!payload) {
      return c.json({ error: "Invalid or expired relay token" }, 401);
    }

    c.set("pool", pool);
    c.set("tokenPayload", payload);
    await next();
  });

  // Register routes
  app.post("/relay/push", (c) => pushRoute(c, pool));
  app.get("/relay/pull", (c) => pullRoute(c, pool));
  app.post("/relay/ack", (c) => ackRoute(c, pool));
  app.get("/relay/status", (c) => statusRoute(c, pool));

  // Telegram webhook proxy — no auth (verified via webhook secret header)
  // Telegram → relay (public) → web app (internal)
  app.post("/telegram/webhook", (c) => telegramProxyRoute(c));

  return app;
}
