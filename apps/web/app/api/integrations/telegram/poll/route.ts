/**
 * Telegram Polling Bridge — OpenClaw-style outbound-only.
 *
 * Called periodically by the frontend (every 3s) when running on localhost.
 * 1. Reads bot token from DB (set via dashboard settings)
 * 2. Calls Telegram getUpdates (outbound — works on localhost)
 * 3. Forwards each update to the webhook handler (local → local)
 *
 * No webhook or external inbound connection needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";

// Track offset across poll calls (per-process, resets on restart)
let pollOffset = 0;

async function getBotToken(): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const result = await pool.query(
      `SELECT bot_token FROM channel_links WHERE channel = 'telegram' AND bot_token IS NOT NULL LIMIT 1`,
    );
    return (result.rows[0]?.bot_token as string) ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  // Auth check — only logged-in users can trigger polling
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getBotToken();
  if (!token) {
    return NextResponse.json({ error: "No bot token configured" }, { status: 400 });
  }

  try {
    // 1. getUpdates (outbound — always works on localhost)
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: pollOffset,
        timeout: 1, // Short timeout — frontend polls every 3s
        allowed_updates: ["message", "callback_query"],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Telegram API ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    if (!data.ok || !data.result?.length) {
      return NextResponse.json({ processed: 0 });
    }

    const updates = data.result;
    let processed = 0;

    // 2. Forward each update to webhook handler (local → local)
    const webhookUrl = `${request.nextUrl.origin}/api/integrations/telegram/webhook`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

    for (const update of updates) {
      // Advance offset past this update
      if (update.update_id >= pollOffset) {
        pollOffset = update.update_id + 1;
      }

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (secret) {
          headers["x-telegram-bot-api-secret-token"] = secret;
        }

        await fetch(webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(update),
          signal: AbortSignal.timeout(30_000),
        });
        processed++;
      } catch (err) {
        console.error("[telegram-poll] Failed to forward update:", (err as Error).message);
      }
    }

    return NextResponse.json({ processed });
  } catch (err) {
    console.error("[telegram-poll] Poll error:", (err as Error).message);
    return NextResponse.json({ error: "Poll failed" }, { status: 500 });
  }
}
