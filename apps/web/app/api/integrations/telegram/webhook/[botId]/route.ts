import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { handleTelegramUpdate } from "../route";

/**
 * Per-bot webhook endpoint.
 *
 * Why this exists: Telegram updates do not carry the bot's identity, only the
 * sender's. When user A and user B each register their own bots against the
 * same /webhook URL, the server cannot tell which bot received an unlinked
 * user's /start — so it ends up replying with whichever token getBotToken()
 * returned, which is usually the wrong one. Telegram then rejects the reply
 * (chat not found) and the user never sees the verification code.
 *
 * Embedding the bot id in the URL solves that: setupTelegramWebhook(token,
 * `${appUrl}/api/integrations/telegram/webhook/${token.split(":")[0]}`) makes
 * Telegram POST here, and we look up the matching bot_token in DB before
 * delegating to the shared handler.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
): Promise<NextResponse> {
  const { botId } = await params;

  // Verify the secret here as well so unauthenticated requests don't trigger DB lookups
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  // Bot ids are always numeric (the digits before the ":" in a Telegram token).
  // Reject anything else early so the LIKE pattern below stays well-formed.
  if (!/^\d+$/.test(botId)) {
    return NextResponse.json({ ok: false, error: "Invalid bot id" }, { status: 400 });
  }

  let pinnedBotToken: string | null = null;
  try {
    const result = await pool.query(
      `SELECT bot_token FROM channel_links
       WHERE channel = 'telegram' AND bot_token LIKE $1 || ':%'
       LIMIT 1`,
      [botId],
    );
    pinnedBotToken = (result.rows[0]?.bot_token as string) ?? null;
  } catch (err) {
    console.error(`[telegram/webhook/${botId}] DB lookup failed:`, err);
  }

  if (!pinnedBotToken) {
    console.error(`[telegram/webhook/${botId}] No bot_token found in channel_links`);
    return NextResponse.json({ ok: false, error: "Bot not registered" }, { status: 404 });
  }

  return handleTelegramUpdate(request, { pinnedBotToken });
}
