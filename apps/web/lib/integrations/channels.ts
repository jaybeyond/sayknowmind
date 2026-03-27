/**
 * Multi-channel integration utilities.
 *
 * Each channel follows the same pattern:
 * 1. Verify token (call provider API to validate)
 * 2. Setup webhook (register callback URL)
 * 3. Link account (generate code, user sends to bot)
 * 4. Handle incoming messages (ingest URLs, answer queries)
 */

export type ChannelId = "telegram" | "slack" | "discord" | "email";

export interface ChannelStatus {
  configured: boolean;
  linked: boolean;
  linkCode: string | null;
  username: string | null;
  linkedAt: string | null;
  botName: string | null;
  webhookActive: boolean;
}

export interface TokenVerifyResult {
  valid: boolean;
  botName?: string;
  botUsername?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

const TELEGRAM_API = "https://api.telegram.org/bot";

export async function verifyTelegramToken(token: string): Promise<TokenVerifyResult> {
  try {
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
      return { valid: false, error: "Invalid token format" };
    }
    const res = await fetch(`${TELEGRAM_API}${token}/getMe`);
    const data = await res.json();
    if (data.ok) {
      return { valid: true, botName: data.result.first_name, botUsername: data.result.username };
    }
    return { valid: false, error: data.description ?? "Invalid token" };
  } catch {
    return { valid: false, error: "Failed to connect to Telegram API" };
  }
}

export async function setupTelegramWebhook(token: string, webhookUrl: string): Promise<boolean> {
  const payload: Record<string, unknown> = { url: webhookUrl, allowed_updates: ["message", "callback_query"] };
  // Pass secret_token so Telegram includes it in webhook requests
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
  }
  const res = await fetch(`${TELEGRAM_API}${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return data.ok === true;
}

export async function removeTelegramWebhook(token: string): Promise<boolean> {
  const res = await fetch(`${TELEGRAM_API}${token}/deleteWebhook`, { method: "POST" });
  const data = await res.json();
  return data.ok === true;
}

export async function getTelegramWebhookInfo(token: string): Promise<{ url: string; pending: number } | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/getWebhookInfo`);
    const data = await res.json();
    if (data.ok) return { url: data.result.url, pending: data.result.pending_update_count };
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export async function verifySlackToken(token: string): Promise<TokenVerifyResult> {
  try {
    if (!token.startsWith("xoxb-")) {
      return { valid: false, error: "Slack bot tokens start with xoxb-" };
    }
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.ok) {
      return { valid: true, botName: data.bot_id, botUsername: data.user };
    }
    return { valid: false, error: data.error ?? "Invalid token" };
  } catch {
    return { valid: false, error: "Failed to connect to Slack API" };
  }
}

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

export async function verifyDiscordToken(token: string): Promise<TokenVerifyResult> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      return { valid: true, botName: data.username, botUsername: data.username };
    }
    return { valid: false, error: `Discord API returned ${res.status}` };
  } catch {
    return { valid: false, error: "Failed to connect to Discord API" };
  }
}

// ---------------------------------------------------------------------------
// Email (SMTP verification)
// ---------------------------------------------------------------------------

export async function verifyEmailConfig(host: string): Promise<TokenVerifyResult> {
  // Basic validation — actual SMTP connection test would require net module
  if (!host || host.length < 3) {
    return { valid: false, error: "Invalid SMTP host" };
  }
  return { valid: true, botName: host, botUsername: host };
}

// ---------------------------------------------------------------------------
// Unified verify
// ---------------------------------------------------------------------------

export async function verifyChannelToken(channel: ChannelId, token: string): Promise<TokenVerifyResult> {
  switch (channel) {
    case "telegram": return verifyTelegramToken(token);
    case "slack": return verifySlackToken(token);
    case "discord": return verifyDiscordToken(token);
    case "email": return verifyEmailConfig(token);
    default: return { valid: false, error: "Unknown channel" };
  }
}
