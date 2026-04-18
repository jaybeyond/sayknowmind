/**
 * Telegram Bot Integration
 *
 * Connects SayKnowMind to Telegram via Bot API webhooks.
 * Users can:
 * - Send URLs, photos, files, and text to save into their knowledge base
 * - Ask questions that get answered via RAG
 * - Choose categories via inline keyboards
 * - Manage their knowledge base via commands
 */

const TELEGRAM_API = "https://api.telegram.org/bot";

// ── Types ────────────────────────────────────────────────────

export interface TelegramConfig {
  botToken: string;
  webhookUrl: string;
  /** Telegram user IDs allowed to use the bot (empty = all linked users) */
  allowedUsers?: number[];
}

export interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string; language_code?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  caption_entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  document?: {
    file_id: string;
    file_unique_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string; username?: string };
  message?: TelegramMessage & { chat: { id: number; type: string } };
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramSendResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export type TelegramMessageType =
  | "command"
  | "url"
  | "photo"
  | "document"
  | "save_text"
  | "callback_query"
  | "query";

// ── Message Classification ───────────────────────────────────

/**
 * Classify an entire Telegram update into a message type.
 * Replaces the old classifyMessage() that only looked at text.
 */
export function classifyUpdate(update: TelegramUpdate): TelegramMessageType {
  if (update.callback_query) return "callback_query";

  const msg = update.message;
  if (!msg) return "query";

  if (msg.photo && msg.photo.length > 0) return "photo";
  if (msg.document) return "document";

  const text = msg.text?.trim() ?? msg.caption?.trim() ?? "";
  if (!text) return "query";

  if (text.startsWith("/")) return "command";

  // Explicit save intent patterns (Korean + English)
  if (/^(저장해[:\s]|메모[:\s]|save[:\s]|memo[:\s]|기록[:\s]|노트[:\s]|note[:\s])/i.test(text)) {
    return "save_text";
  }

  // URL detection
  if (/^https?:\/\//i.test(text)) return "url";
  if (msg.entities?.some((e) => e.type === "url" || e.type === "text_link")) return "url";

  return "query";
}

/** @deprecated Use classifyUpdate() instead */
export function classifyMessage(text: string): "url" | "query" | "command" {
  const trimmed = text.trim();
  if (trimmed.startsWith("/")) return "command";
  if (/^https?:\/\//i.test(trimmed)) return "url";
  return "query";
}

// ── Webhook Management ──────────────────────────────────────

export async function setWebhook(botToken: string, webhookUrl: string): Promise<boolean> {
  const res = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] }),
  });
  const data = await res.json();
  return data.ok === true;
}

export async function deleteWebhook(botToken: string): Promise<boolean> {
  const res = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`, { method: "POST" });
  const data = await res.json();
  return data.ok === true;
}

export async function getWebhookInfo(botToken: string): Promise<{ url: string; pending: number } | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/getWebhookInfo`);
    const data = await res.json();
    if (data.ok) return { url: data.result.url, pending: data.result.pending_update_count };
    return null;
  } catch {
    return null;
  }
}

// ── Messaging ───────────────────────────────────────────────

export async function sendMessage(
  botToken: string,
  chatId: number,
  text: string,
  options?: {
    parseMode?: "HTML" | "Markdown";
    replyToMessageId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  },
): Promise<TelegramSendResult> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode ?? "HTML",
  };
  if (options?.replyToMessageId) body.reply_to_message_id = options.replyToMessageId;
  if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

  const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function sendTyping(botToken: string, chatId: number): Promise<void> {
  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram] sendTyping failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error("[telegram] sendTyping error:", err);
  }
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await fetch(`${TELEGRAM_API}${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => {});
}

export async function editMessageText(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
  options?: { parseMode?: "HTML" | "Markdown" },
): Promise<void> {
  await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options?.parseMode ?? "HTML",
    }),
  }).catch(() => {});
}

export async function editMessageReplyMarkup(
  botToken: string,
  chatId: number,
  messageId: number,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  await fetch(`${TELEGRAM_API}${botToken}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    }),
  }).catch(() => {});
}

// ── File Handling ────────────────────────────────────────────

export async function getFile(
  botToken: string,
  fileId: string,
): Promise<{ file_path: string; file_size?: number } | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await res.json();
    if (data.ok) return { file_path: data.result.file_path, file_size: data.result.file_size };
    return null;
  } catch {
    return null;
  }
}

export async function downloadFile(botToken: string, filePath: string): Promise<Buffer> {
  const res = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── URL Extraction ──────────────────────────────────────────

export function extractUrls(update: TelegramUpdate): string[] {
  const msg = update.message;
  const text = msg?.text ?? msg?.caption ?? "";
  const entities = msg?.entities ?? msg?.caption_entities ?? [];
  if (!text || entities.length === 0) return [];

  const urls: string[] = [];
  for (const entity of entities) {
    if (entity.type === "url") {
      urls.push(text.substring(entity.offset, entity.offset + entity.length));
    } else if (entity.type === "text_link" && entity.url) {
      urls.push(entity.url);
    }
  }
  return urls;
}

// ── Bot Info ─────────────────────────────────────────────────

export function isValidBotToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{35,}$/.test(token);
}

export async function getBotInfo(botToken: string): Promise<{ id: number; name: string; username: string } | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
    const data = await res.json();
    if (data.ok) {
      return { id: data.result.id, name: data.result.first_name, username: data.result.username };
    }
    return null;
  } catch {
    return null;
  }
}
