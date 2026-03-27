import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import {
  verifyChannelToken,
  setupTelegramWebhook,
  removeTelegramWebhook,
  getTelegramWebhookInfo,
  verifyTelegramToken,
  type ChannelId,
  type ChannelStatus,
} from "@/lib/integrations/channels";
import crypto from "crypto";

const VALID_CHANNELS: ChannelId[] = ["telegram", "slack", "discord", "email"];

function getChannel(params: { channel: string }): ChannelId | null {
  const ch = params.channel as ChannelId;
  return VALID_CHANNELS.includes(ch) ? ch : null;
}

function getTokenEnvKey(channel: ChannelId): string {
  const map: Record<ChannelId, string> = {
    telegram: "TELEGRAM_BOT_TOKEN",
    slack: "SLACK_BOT_TOKEN",
    discord: "DISCORD_BOT_TOKEN",
    email: "EMAIL_SMTP_HOST",
  };
  return map[channel];
}

/**
 * GET — Channel integration status for the current user.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel: channelParam } = await params;
  const channel = getChannel({ channel: channelParam });
  if (!channel) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ code: 1002, message: "Unauthorized" }, { status: 401 });
  }

  const envKey = getTokenEnvKey(channel);
  const envToken = process.env[envKey];

  // Check linked account + saved token from DB
  const link = await pool
    .query(
      `SELECT channel_user_id, channel_username, link_code, linked_at, bot_token, bot_name, bot_username
       FROM channel_links WHERE user_id = $1 AND channel = $2`,
      [userId, channel],
    )
    .catch(() => ({ rows: [] }));

  const row = link.rows[0];
  const linked = !!row?.channel_user_id;
  // Configured = has token in DB or in env
  const savedToken = row?.bot_token as string | null;
  const token = savedToken ?? envToken ?? null;
  const configured = !!token;

  let botName: string | null = row?.bot_username ?? row?.bot_name ?? null;
  let webhookActive = false;

  if (configured && token && channel === "telegram") {
    const whInfo = await getTelegramWebhookInfo(token).catch(() => null);
    webhookActive = !!(whInfo?.url);
    if (!botName) {
      const botInfo = await verifyTelegramToken(token).catch(() => null);
      botName = botInfo?.botUsername ?? null;
    }
  }

  const status: ChannelStatus = {
    configured,
    linked,
    linkCode: row?.link_code ?? null,
    username: row?.channel_username ?? null,
    linkedAt: row?.linked_at ?? null,
    botName,
    webhookActive,
  };

  return NextResponse.json(status);
}

/**
 * POST — Channel actions: verifyToken, generateLinkCode, setupWebhook, removeWebhook
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel: channelParam } = await params;
  const channel = getChannel({ channel: channelParam });
  if (!channel) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ code: 1002, message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const action = body.action as string;

  // Verify token and save if valid
  if (action === "verifyAndSave") {
    const token = body.token as string;
    if (!token) {
      return NextResponse.json({ valid: false, error: "Token is required" }, { status: 400 });
    }
    console.log(`[integrations/${channel}] verifyAndSave: token length=${token.length}, prefix=${token.slice(0, 6)}...`);
    const result = await verifyChannelToken(channel, token);
    console.log(`[integrations/${channel}] verifyAndSave result:`, JSON.stringify(result));
    if (result.valid) {
      // Save token to user's channel config in DB
      try {
        await pool.query(
          `INSERT INTO channel_links (user_id, channel, bot_token, bot_name, bot_username)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, channel)
           DO UPDATE SET bot_token = $3, bot_name = $4, bot_username = $5, updated_at = NOW()`,
          [userId, channel, token, result.botName ?? null, result.botUsername ?? null],
        );
        console.log(`[integrations/${channel}] Token saved for user ${userId}`);
      } catch (dbErr) {
        console.error(`[integrations/${channel}] DB save failed:`, dbErr);
        return NextResponse.json({ valid: true, saved: false, error: "Failed to save token to database" });
      }
      return NextResponse.json({ ...result, saved: true });
    }
    return NextResponse.json(result);
  }

  // Verify token only (no save)
  if (action === "verifyToken") {
    const token = body.token as string;
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    const result = await verifyChannelToken(channel, token);
    return NextResponse.json(result);
  }

  // Link by telegram user ID (manual input)
  if (action === "linkByUserId") {
    const channelUserId = body.channelUserId as string;
    const channelUsername = body.channelUsername as string | undefined;
    if (!channelUserId) {
      return NextResponse.json({ error: "Channel user ID is required" }, { status: 400 });
    }
    await pool.query(
      `INSERT INTO channel_links (user_id, channel, channel_user_id, channel_username, linked_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, channel)
       DO UPDATE SET channel_user_id = $3, channel_username = $4, linked_at = NOW()`,
      [userId, channel, channelUserId, channelUsername ?? null],
    );
    return NextResponse.json({ ok: true, linked: true });
  }

  // Generate link code
  if (action === "generateLinkCode") {
    const code = crypto.randomBytes(16).toString("hex");
    await pool.query(
      `INSERT INTO channel_links (user_id, channel, link_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, channel)
       DO UPDATE SET link_code = $3, channel_user_id = NULL, channel_username = NULL, linked_at = NULL`,
      [userId, channel, code],
    );
    return NextResponse.json({ linkCode: code });
  }

  // Setup webhook
  if (action === "setupWebhook") {
    // Get token from DB first, then env
    const dbRow = await pool.query(
      `SELECT bot_token FROM channel_links WHERE user_id = $1 AND channel = $2`,
      [userId, channel],
    ).catch(() => ({ rows: [] }));
    const token = (dbRow.rows[0]?.bot_token as string) ?? process.env[getTokenEnvKey(channel)];
    if (!token) {
      return NextResponse.json({ error: "Token not configured. Verify your token first." }, { status: 400 });
    }

    if (channel === "telegram") {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const webhookUrl = `${appUrl}/api/integrations/telegram/webhook`;
      const ok = await setupTelegramWebhook(token, webhookUrl);
      return NextResponse.json({ ok, webhookUrl });
    }

    // Slack/Discord use different webhook patterns (event subscriptions)
    return NextResponse.json({ ok: true, message: `${channel} uses event subscriptions, not webhooks` });
  }

  // Remove webhook
  if (action === "removeWebhook") {
    const dbRow = await pool.query(
      `SELECT bot_token FROM channel_links WHERE user_id = $1 AND channel = $2`,
      [userId, channel],
    ).catch(() => ({ rows: [] }));
    const token = (dbRow.rows[0]?.bot_token as string) ?? process.env[getTokenEnvKey(channel)];
    if (!token) {
      return NextResponse.json({ error: "Token not configured" }, { status: 400 });
    }

    if (channel === "telegram") {
      const ok = await removeTelegramWebhook(token);
      return NextResponse.json({ ok });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/**
 * DELETE — Unlink channel account for the current user.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel: channelParam } = await params;
  const channel = getChannel({ channel: channelParam });
  if (!channel) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ code: 1002, message: "Unauthorized" }, { status: 401 });
  }

  await pool.query(`DELETE FROM channel_links WHERE user_id = $1 AND channel = $2`, [userId, channel]);
  return NextResponse.json({ ok: true });
}
