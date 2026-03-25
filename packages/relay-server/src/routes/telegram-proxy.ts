/**
 * Telegram Webhook Proxy — OpenClaw-style outbound forwarding.
 *
 * Telegram → relay-server (public URL) → web app (internal/local)
 *
 * No auth needed from Telegram — verified via webhook secret header.
 * The relay acts as a dumb pipe, forwarding the raw JSON body to the web app.
 */
import type { Context } from "hono";

const WEB_APP_URL = process.env.WEB_APP_URL ?? "http://localhost:3000";
const FORWARD_TIMEOUT = 30_000;

export async function telegramProxyRoute(c: Context): Promise<Response> {
  // Verify Telegram webhook secret if configured
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const headerSecret = c.req.header("x-telegram-bot-api-secret-token");
    if (headerSecret !== secret) {
      return c.json({ ok: false, error: "Forbidden" }, 403);
    }
  }

  const body = await c.req.text();

  try {
    // Forward to web app's webhook handler (relay → web app, internal network)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (secret) {
      headers["x-telegram-bot-api-secret-token"] = secret;
    }

    const res = await fetch(
      `${WEB_APP_URL}/api/integrations/telegram/webhook`,
      {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT),
      },
    );

    // Return web app's response status
    const resBody = await res.text();
    return new Response(resBody, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(
      "[relay] Telegram proxy failed:",
      err instanceof Error ? err.message : err,
    );
    // Return 200 to Telegram so it doesn't retry endlessly
    return c.json({ ok: true, proxied: false });
  }
}
