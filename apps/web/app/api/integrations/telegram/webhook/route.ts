import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  sendMessage,
  sendTyping,
  extractUrls,
  classifyUpdate,
  getFile,
  downloadFile,
  answerCallbackQuery,
  editMessageText,
  editMessageReplyMarkup,
  type TelegramUpdate,
  type TelegramInlineKeyboardMarkup,
} from "@/lib/integrations/telegram";
import { insertDocument, assignDocumentCategory, findDuplicateByUrl, findDuplicateByFileName, deduplicateName } from "@/lib/ingest/document-store";
import { createJob, getJobStatus } from "@/lib/ingest/job-queue";
import { fetchUrl } from "@/lib/ingest/url-fetcher";
import { parseFile } from "@/lib/ingest/parsers";
import { saveFile } from "@/lib/ingest/file-storage";
import { listCategories, type CategoryRow } from "@/lib/categories/store";
import { callAiCloudFirst } from "@/lib/agents/cloud-ai";

// ── i18n Message Map ─────────────────────────────────────────

type Lang = "en" | "ko" | "ja" | "zh";
const SUPPORTED_LANGS: Lang[] = ["en", "ko", "ja", "zh"];
const LANG_LABELS: Record<Lang, string> = { en: "English", ko: "한국어", ja: "日本語", zh: "中文" };

const t: Record<string, Record<Lang, string>> = {
  accountNotLinked:   { en: "Account not linked.", ko: "계정이 연결되지 않았습니다.", ja: "アカウントが連携されていません。", zh: "账号未关联。" },
  savedToCategory:    { en: "Saved to <b>📁 {name}</b>.", ko: "<b>📁 {name}</b> 카테고리에 저장되었습니다.", ja: "<b>📁 {name}</b> に保存しました。", zh: "已保存到 <b>📁 {name}</b>。" },
  docOrCatNotFound:   { en: "Document or category not found.", ko: "문서 또는 카테고리를 찾을 수 없습니다.", ja: "ドキュメントまたはカテゴリが見つかりません。", zh: "找不到文档或分类。" },
  skipped:            { en: "Skipped — saved without category.", ko: "건너뜀 — 카테고리 없이 저장됨.", ja: "スキップ — カテゴリなしで保存。", zh: "已跳过 — 未分类保存。" },
  skipBtn:            { en: "Skip ⏭", ko: "건너뛰기 ⏭", ja: "スキップ ⏭", zh: "跳过 ⏭" },
  langSet:            { en: "Language set to English.", ko: "언어가 한국어로 설정되었습니다.", ja: "言語を日本語に設定しました。", zh: "语言已设置为中文。" },
  langPrompt:         { en: "Choose your language:", ko: "언어를 선택하세요:", ja: "言語を選択してください:", zh: "请选择语言:" },
  startLinked:        { en: "✅ Account linked!\n\nYou can now:\n📎 Send URL → save web page\n📷 Send photo/file → save to knowledge base\n💬 Ask questions → search saved knowledge\n📝 \"save: ...\" → save text memo\n\n/help for all commands.", ko: "✅ 계정이 연결되었습니다!\n\n이제 할 수 있는 것:\n📎 URL 보내기 → 웹페이지 저장\n📷 사진/파일 보내기 → 지식베이스에 저장\n💬 질문하기 → 저장된 지식에서 검색\n📝 \"저장해: ...\" → 텍스트 메모 저장\n\n/help 로 전체 명령어를 확인하세요.", ja: "✅ アカウントが連携されました!\n\nできること:\n📎 URL送信 → ウェブページ保存\n📷 写真/ファイル送信 → ナレッジベースに保存\n💬 質問 → 保存された知識を検索\n📝 \"メモ: ...\" → テキストメモ保存\n\n/help で全コマンドを確認。", zh: "✅ 账号已关联!\n\n现在可以:\n📎 发送URL → 保存网页\n📷 发送照片/文件 → 保存到知识库\n💬 提问 → 搜索已保存知识\n📝 \"保存: ...\" → 保存文字备忘\n\n/help 查看全部命令。" },
  startBadCode:       { en: "❌ Invalid or expired link code.\nGo to Settings → Integrations → Telegram to generate a new one.", ko: "❌ 유효하지 않거나 만료된 연결 코드입니다.\n설정 → 연동 → Telegram에서 새 코드를 생성하세요.", ja: "❌ 無効または期限切れのコードです。\n設定 → 連携 → Telegramで新しいコードを生成してください。", zh: "❌ 无效或已过期的关联码。\n请在设置 → 集成 → Telegram中生成新码。" },
  startAlready:       { en: "👋 Account already linked.\n\n/help for usage.", ko: "👋 이미 연결된 계정입니다.\n\n/help 로 사용법을 확인하세요.", ja: "👋 すでに連携済みです。\n\n/help で使い方を確認。", zh: "👋 账号已关联。\n\n/help 查看用法。" },
  startWelcome:       { en: "👋 SayKnowMind Bot.\n\nTo link your account:\n1️⃣ Settings → Integrations → Telegram → \"Generate link code\"\n2️⃣ Send <code>/start code</code>\n\nYour ID: <code>{tgId}</code>", ko: "👋 SayKnowMind Bot입니다.\n\n계정을 연결하려면:\n1️⃣ 설정 → 연동 → Telegram → \"연결 코드 생성\"\n2️⃣ 생성된 코드로 <code>/start 코드</code> 전송\n\n내 ID: <code>{tgId}</code>", ja: "👋 SayKnowMind Botです。\n\nアカウント連携:\n1️⃣ 設定 → 連携 → Telegram → 「コード生成」\n2️⃣ <code>/start コード</code>を送信\n\nあなたのID: <code>{tgId}</code>", zh: "👋 SayKnowMind Bot。\n\n关联账号:\n1️⃣ 设置 → 集成 → Telegram → \"生成关联码\"\n2️⃣ 发送 <code>/start 码</code>\n\n你的ID: <code>{tgId}</code>" },
  startAutoCreated:   { en: "✅ Welcome to SayKnowMind!\n\nYour account has been created automatically.\n\n📎 Send URL → save web page\n📷 Send photo/file → save to knowledge base\n💬 Ask questions → search saved knowledge\n📝 \"save: ...\" → save text memo\n\n/help for all commands.", ko: "✅ SayKnowMind에 오신 것을 환영합니다!\n\n계정이 자동으로 생성되었습니다.\n\n📎 URL 보내기 → 웹페이지 저장\n📷 사진/파일 보내기 → 지식베이스에 저장\n💬 질문하기 → 저장된 지식에서 검색\n📝 \"저장해: ...\" → 텍스트 메모 저장\n\n/help 로 전체 명령어를 확인하세요.", ja: "✅ SayKnowMindへようこそ!\n\nアカウントが自動作成されました。\n\n📎 URL送信 → ウェブページ保存\n📷 写真/ファイル送信 → ナレッジベースに保存\n💬 質問 → 保存された知識を検索\n📝 \"メモ: ...\" → テキストメモ保存\n\n/help で全コマンドを確認。", zh: "✅ 欢迎使用SayKnowMind!\n\n账号已自动创建。\n\n📎 发送URL → 保存网页\n📷 发送照片/文件 → 保存到知识库\n💬 提问 → 搜索已保存知识\n📝 \"保存: ...\" → 保存文字备忘\n\n/help 查看全部命令。" },
  help:               { en: "📚 <b>SayKnowMind Bot Usage</b>\n\n<b>Save:</b>\n📎 Send URL → save web page + AI analysis\n📷 Send photo → save image + OCR\n📄 Send file → save document (PDF, DOCX, etc.)\n📝 <code>save: content</code> → save text memo\n📝 <code>/memo content</code> → quick memo\n\n<b>Search:</b>\n💬 Ask a question → search saved knowledge\n🔍 <code>/search query</code> → direct search\n\n<b>Manage:</b>\n/categories — category list\n/recent — recent documents\n/status — service status\n/lang — change language\n/myid — Telegram ID\n/unlink — disconnect", ko: "📚 <b>SayKnowMind Bot 사용법</b>\n\n<b>저장하기:</b>\n📎 URL 보내기 → 웹페이지 저장 + AI 분석\n📷 사진 보내기 → 이미지 저장 + OCR\n📄 파일 보내기 → 문서 저장 (PDF, DOCX 등)\n📝 <code>저장해: 내용</code> → 텍스트 메모 저장\n📝 <code>/memo 내용</code> → 빠른 메모 저장\n\n<b>검색하기:</b>\n💬 질문하면 저장된 지식에서 답변\n🔍 <code>/search 검색어</code> → 직접 검색\n\n<b>관리:</b>\n/categories — 카테고리 목록\n/recent — 최근 저장 문서\n/status — 서비스 상태\n/lang — 언어 변경\n/myid — 텔레그램 ID\n/unlink — 연결 해제", ja: "📚 <b>SayKnowMind Bot 使い方</b>\n\n<b>保存:</b>\n📎 URL送信 → ウェブページ保存 + AI分析\n📷 写真送信 → 画像保存 + OCR\n📄 ファイル送信 → ドキュメント保存\n📝 <code>メモ: 内容</code> → テキストメモ\n📝 <code>/memo 内容</code> → クイックメモ\n\n<b>検索:</b>\n💬 質問 → 保存済み知識を検索\n🔍 <code>/search キーワード</code> → 直接検索\n\n<b>管理:</b>\n/categories — カテゴリ一覧\n/recent — 最近の保存\n/status — サービス状態\n/lang — 言語変更\n/myid — Telegram ID\n/unlink — 連携解除", zh: "📚 <b>SayKnowMind Bot 用法</b>\n\n<b>保存:</b>\n📎 发送URL → 保存网页 + AI分析\n📷 发送照片 → 保存图片 + OCR\n📄 发送文件 → 保存文档\n📝 <code>保存: 内容</code> → 文字备忘\n📝 <code>/memo 内容</code> → 快捷备忘\n\n<b>搜索:</b>\n💬 提问 → 搜索已保存知识\n🔍 <code>/search 关键词</code> → 直接搜索\n\n<b>管理:</b>\n/categories — 分类列表\n/recent — 最近文档\n/status — 服务状态\n/lang — 切换语言\n/myid — Telegram ID\n/unlink — 解除关联" },
  myId:               { en: "🆔 Telegram ID: <code>{tgId}</code>\n\nEnter this ID in Settings → Integrations → Telegram to link.", ko: "🆔 텔레그램 ID: <code>{tgId}</code>\n\n설정 → 연동 → Telegram에서 이 ID를 입력하면 연결할 수 있습니다.", ja: "🆔 Telegram ID: <code>{tgId}</code>\n\n設定 → 連携 → Telegramでこの IDを入力して連携。", zh: "🆔 Telegram ID: <code>{tgId}</code>\n\n在设置 → 集成 → Telegram中输入此ID即可关联。" },
  unlinked:           { en: "✅ Account disconnected.", ko: "✅ 계정 연결이 해제되었습니다.", ja: "✅ アカウント連携を解除しました。", zh: "✅ 账号已解除关联。" },
  statusOk:           { en: "🟢 SayKnowMind running\n📄 Documents: {docs}\n📁 Categories: {cats}", ko: "🟢 SayKnowMind 정상 작동 중\n📄 문서: {docs}개\n📁 카테고리: {cats}개", ja: "🟢 SayKnowMind 稼働中\n📄 ドキュメント: {docs}\n📁 カテゴリ: {cats}", zh: "🟢 SayKnowMind 运行中\n📄 文档: {docs}\n📁 分类: {cats}" },
  statusNoLink:       { en: "🟢 SayKnowMind Bot running\n⚠️ Account not linked.", ko: "🟢 SayKnowMind Bot 정상 작동 중\n⚠️ 계정이 연결되지 않았습니다.", ja: "🟢 SayKnowMind Bot 稼働中\n⚠️ アカウント未連携。", zh: "🟢 SayKnowMind Bot 运行中\n⚠️ 账号未关联。" },
  noDocs:             { en: "No documents yet. Send a URL or file to get started!", ko: "아직 문서가 없습니다. URL이나 파일을 보내서 시작하세요!", ja: "まだドキュメントがありません。URLまたはファイルを送信して開始!", zh: "还没有文档。发送URL或文件开始!" },
  recentDocs:         { en: "📄 Recent documents:", ko: "📄 최근 문서:", ja: "📄 最近のドキュメント:", zh: "📄 最近文档:" },
  noCats:             { en: "No categories yet. Save a document and AI will suggest categories.", ko: "아직 카테고리가 없습니다. 문서를 저장하면 AI가 자동으로 카테고리를 추천해줘요.", ja: "まだカテゴリがありません。ドキュメントを保存するとAIが提案します。", zh: "还没有分类。保存文档后AI会自动推荐分类。" },
  catList:            { en: "📁 Categories:", ko: "📁 카테고리 목록:", ja: "📁 カテゴリ一覧:", zh: "📁 分类列表:" },
  memoUsage:          { en: "Usage: <code>/memo content</code>", ko: "사용법: <code>/memo 메모할 내용</code>", ja: "使い方: <code>/memo 内容</code>", zh: "用法: <code>/memo 内容</code>" },
  memoSaved:          { en: "📝 Memo saved: <b>{title}</b>", ko: "📝 메모 저장됨: <b>{title}</b>", ja: "📝 メモ保存: <b>{title}</b>", zh: "📝 备忘已保存: <b>{title}</b>" },
  memoFail:           { en: "❌ Failed to save memo. Please try again.", ko: "❌ 메모 저장 실패. 다시 시도하세요.", ja: "❌ メモの保存に失敗しました。もう一度お試しください。", zh: "❌ 备忘保存失败。请重试。" },
  searchUsage:        { en: "Usage: <code>/search query</code>", ko: "사용법: <code>/search 검색어</code>", ja: "使い方: <code>/search キーワード</code>", zh: "用法: <code>/search 关键词</code>" },
  searchResults:      { en: "🔍 Search results:", ko: "🔍 검색 결과:", ja: "🔍 検索結果:", zh: "🔍 搜索结果:" },
  searchEmpty:        { en: "No results found.", ko: "검색 결과가 없습니다.", ja: "検索結果がありません。", zh: "未找到结果。" },
  linkFirst:          { en: "Please link your account first.\nYour ID: <code>{tgId}</code>\n\n/start for instructions.", ko: "계정을 먼저 연결하세요.\n내 ID: <code>{tgId}</code>\n\n/start 로 연결 방법을 확인하세요.", ja: "先にアカウントを連携してください。\nあなたのID: <code>{tgId}</code>\n\n/start で手順を確認。", zh: "请先关联账号。\n你的ID: <code>{tgId}</code>\n\n/start 查看说明。" },
  linkFirstShort:     { en: "Please link your account first.\nSettings → Integrations → Telegram\n\nYour ID: <code>{tgId}</code>", ko: "계정을 먼저 연결하세요.\n설정 → 연동 → Telegram\n\n내 ID: <code>{tgId}</code>", ja: "先にアカウントを連携してください。\n設定 → 連携 → Telegram\n\nあなたのID: <code>{tgId}</code>", zh: "请先关联账号。\n设置 → 集成 → Telegram\n\n你的ID: <code>{tgId}</code>" },
  urlSaved:           { en: "✅ Saved: <b>{title}</b>", ko: "✅ 저장됨: <b>{title}</b>", ja: "✅ 保存: <b>{title}</b>", zh: "✅ 已保存: <b>{title}</b>" },
  urlFail:            { en: "❌ Failed to save URL. Check the URL and try again.", ko: "❌ URL 저장 실패. URL을 확인하고 다시 시도하세요.", ja: "❌ URL保存に失敗。URLを確認して再試行してください。", zh: "❌ URL保存失败。请检查URL后重试。" },
  photoSaved:         { en: "📷 Image saved: <b>{title}</b>", ko: "📷 이미지 저장됨: <b>{title}</b>", ja: "📷 画像保存: <b>{title}</b>", zh: "📷 图片已保存: <b>{title}</b>" },
  photoFail:          { en: "❌ Failed to save image. Please try again.", ko: "❌ 이미지 저장 실패. 다시 시도하세요.", ja: "❌ 画像の保存に失敗しました。もう一度お試しください。", zh: "❌ 图片保存失败。请重试。" },
  fileTooLarge:       { en: "❌ File too large (max 20MB).", ko: "❌ 파일이 너무 큽니다 (최대 20MB).", ja: "❌ ファイルが大きすぎます（最大20MB）。", zh: "❌ 文件太大（最大20MB）。" },
  fileTooLargeUpload: { en: "❌ File too large (max 20MB). Upload directly via web.", ko: "❌ 파일이 너무 큽니다 (최대 20MB). 웹에서 직접 업로드하세요.", ja: "❌ ファイルが大きすぎます（最大20MB）。ウェブから直接アップロードしてください。", zh: "❌ 文件太大（最大20MB）。请通过网页直接上传。" },
  fileSaved:          { en: "📄 File saved: <b>{title}</b>", ko: "📄 파일 저장됨: <b>{title}</b>", ja: "📄 ファイル保存: <b>{title}</b>", zh: "📄 文件已保存: <b>{title}</b>" },
  fileFail:           { en: "❌ Failed to save file. Supported: PDF, DOCX, TXT, images.", ko: "❌ 파일 저장 실패. 지원 형식: PDF, DOCX, TXT, 이미지", ja: "❌ ファイル保存に失敗。対応形式: PDF, DOCX, TXT, 画像", zh: "❌ 文件保存失败。支持格式: PDF, DOCX, TXT, 图片" },
  saveTextEmpty:      { en: "Enter content to save.\nExample: <code>save: meeting notes</code>", ko: "저장할 내용을 입력하세요.\n예: <code>저장해: 오늘 회의 내용</code>", ja: "保存する内容を入力してください。\n例: <code>メモ: 会議内容</code>", zh: "请输入要保存的内容。\n例: <code>保存: 会议内容</code>" },
  saveTextFail:       { en: "❌ Failed to save memo.", ko: "❌ 메모 저장 실패.", ja: "❌ メモの保存に失敗しました。", zh: "❌ 备忘保存失败。" },
  aiFallbackSearch:   { en: "🔍 Related documents:", ko: "🔍 관련 문서:", ja: "🔍 関連ドキュメント:", zh: "🔍 相关文档:" },
  aiUnavailable:      { en: "AI service is temporarily unavailable. Please try again shortly.", ko: "AI 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", ja: "AIサービスに一時的に接続できません。しばらくしてからもう一度お試しください。", zh: "AI服务暂时无法连接。请稍后再试。" },
  aiError:            { en: "❌ An error occurred. Please try again.", ko: "❌ 처리 중 오류가 발생했습니다. 다시 시도해주세요.", ja: "❌ エラーが発生しました。もう一度お試しください。", zh: "❌ 发生错误。请重试。" },
  imageLabel:         { en: "Telegram image", ko: "텔레그램 이미지", ja: "Telegram画像", zh: "Telegram图片" },
  jobDone:            { en: "✅ AI analysis complete for <b>{title}</b>:\n{summary}", ko: "✅ <b>{title}</b> AI 분석 완료:\n{summary}", ja: "✅ <b>{title}</b> AI分析完了:\n{summary}", zh: "✅ <b>{title}</b> AI分析完成:\n{summary}" },
  jobFailed:          { en: "⚠️ AI analysis failed for <b>{title}</b>. The document is saved but not summarized.", ko: "⚠️ <b>{title}</b> AI 분석 실패. 문서는 저장되었으나 요약되지 않았습니다.", ja: "⚠️ <b>{title}</b> AI分析に失敗。ドキュメントは保存済みですが要約されていません。", zh: "⚠️ <b>{title}</b> AI分析失败。文档已保存但未生成摘要。" },
  dupFound:           { en: "⚠️ Already saved: <b>{title}</b>\nSave a copy with a different name?", ko: "⚠️ 이미 저장됨: <b>{title}</b>\n다른 이름으로 복사본을 저장할까요?", ja: "⚠️ 既に保存済み: <b>{title}</b>\n別名でコピーを保存しますか？", zh: "⚠️ 已存在: <b>{title}</b>\n用不同名称保存副本？" },
  dupSaveBtn:         { en: "Save copy ✅", ko: "복사본 저장 ✅", ja: "コピー保存 ✅", zh: "保存副本 ✅" },
  dupCancelBtn:       { en: "Cancel ❌", ko: "취소 ❌", ja: "キャンセル ❌", zh: "取消 ❌" },
  dupSaved:           { en: "✅ Copy saved: <b>{title}</b>", ko: "✅ 복사본 저장됨: <b>{title}</b>", ja: "✅ コピー保存: <b>{title}</b>", zh: "✅ 副本已保存: <b>{title}</b>" },
  dupCancelled:       { en: "❌ Cancelled — not saved.", ko: "❌ 취소됨 — 저장하지 않았습니다.", ja: "❌ キャンセル — 保存されませんでした。", zh: "❌ 已取消 — 未保存。" },
};

/** Get a translated string, replacing {key} placeholders. */
function msg(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const template = t[key]?.[lang] ?? t[key]?.en ?? key;
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(String(v)), template,
  );
}

// ── Pending Duplicate Saves (in-memory, 5-min TTL) ──────────

import { randomBytes } from "node:crypto";

interface PendingDup {
  type: "url" | "photo" | "document";
  userId: string;
  lang: Lang;
  url?: string;
  fileId?: string;
  fileName?: string;
  caption?: string;
  mimeType?: string;
  existingTitle: string;
  expiresAt: number;
}

const pendingDups = new Map<string, PendingDup>();

function storePendingDup(data: Omit<PendingDup, "expiresAt">): string {
  // Clean expired
  const now = Date.now();
  for (const [k, v] of pendingDups) {
    if (v.expiresAt < now) pendingDups.delete(k);
  }
  const id = randomBytes(4).toString("hex");
  pendingDups.set(id, { ...data, expiresAt: now + 5 * 60_000 });
  return id;
}

function buildDupKeyboard(dupId: string, lang: Lang): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: msg("dupSaveBtn", lang), callback_data: `dup:y:${dupId}` },
      { text: msg("dupCancelBtn", lang), callback_data: `dup:n:${dupId}` },
    ]],
  };
}

// ── Bot Token Resolution ─────────────────────────────────────

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

async function getBotTokenForTelegramUser(telegramUserId: string): Promise<{ token: string | null; lang: Lang }> {
  try {
    // Join with user table to get the browser-set locale as primary language source
    const result = await pool.query(
      `SELECT cl.bot_token, cl.user_id, u.locale, cl.lang
       FROM channel_links cl
       LEFT JOIN "user" u ON u.id = cl.user_id
       WHERE cl.channel = 'telegram' AND cl.channel_user_id = $1`,
      [telegramUserId],
    );
    const row = result.rows[0];
    if (row) {
      // Priority: user.locale (browser setting) > channel_links.lang (telegram /lang) > "en"
      const userLocale = row.locale as string | null;
      const channelLang = row.lang as string | null;
      const lang = (
        userLocale && SUPPORTED_LANGS.includes(userLocale as Lang) ? userLocale
        : channelLang && SUPPORTED_LANGS.includes(channelLang as Lang) ? channelLang
        : "en"
      ) as Lang;
      return {
        token: (row.bot_token as string) ?? null,
        lang,
      };
    }
  } catch { /* fallback */ }
  const fb = await getBotToken();
  return { token: fb, lang: "en" };
}

// ── Language Preference ──────────────────────────────────────

async function getUserLang(tgUserId: string): Promise<Lang> {
  try {
    const result = await pool.query(
      `SELECT u.locale, cl.lang
       FROM channel_links cl
       LEFT JOIN "user" u ON u.id = cl.user_id
       WHERE cl.channel = 'telegram' AND cl.channel_user_id = $1`,
      [tgUserId],
    );
    const row = result.rows[0];
    if (row) {
      const userLocale = row.locale as string | null;
      const channelLang = row.lang as string | null;
      if (userLocale && SUPPORTED_LANGS.includes(userLocale as Lang)) return userLocale as Lang;
      if (channelLang && SUPPORTED_LANGS.includes(channelLang as Lang)) return channelLang as Lang;
    }
  } catch { /* default */ }
  return "en";
}

async function setUserLang(tgUserId: string, lang: Lang): Promise<void> {
  // Update both channel_links.lang AND user.locale to keep them in sync
  const result = await pool.query(
    `UPDATE channel_links SET lang = $1, updated_at = NOW()
     WHERE channel = 'telegram' AND channel_user_id = $2 RETURNING user_id`,
    [lang, tgUserId],
  );
  const userId = result.rows[0]?.user_id;
  if (userId) {
    await pool.query(
      `UPDATE "user" SET locale = $1, "updatedAt" = NOW() WHERE id = $2`,
      [lang, userId],
    ).catch(() => {});
  }
}

// ── Category Inline Keyboard ─────────────────────────────────

function buildCategoryKeyboard(
  categories: CategoryRow[],
  documentId: string,
  lang: Lang,
): TelegramInlineKeyboardMarkup {
  const doc12 = documentId.substring(0, 12);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  const top = categories.slice(0, 10);
  for (let i = 0; i < top.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    row.push({
      text: `📁 ${top[i].name}`,
      callback_data: `c:${doc12}:${top[i].id.substring(0, 12)}`,
    });
    if (top[i + 1]) {
      row.push({
        text: `📁 ${top[i + 1].name}`,
        callback_data: `c:${doc12}:${top[i + 1].id.substring(0, 12)}`,
      });
    }
    rows.push(row);
  }

  rows.push([{ text: msg("skipBtn", lang), callback_data: `skip:${doc12}` }]);

  return { inline_keyboard: rows };
}

// ── System Prompt Builder ────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese",
};

function buildSystemPrompt(params: {
  context: string;
  docCount: number;
  recentDocs: string[];
  categoryCount: number;
  userName?: string;
  lang?: string;
  conversationHistory?: string;
}): string {
  const { context, docCount, recentDocs, categoryCount, userName, lang = "en", conversationHistory } = params;
  const langName = LANG_NAMES[lang] ?? "English";

  let prompt = `You are SayKnowMind's AI assistant — a personal knowledge management system (Second Brain).

The user interacts via Telegram. They can:
• Send URLs → save web pages with AI summary
• Send photos/files → save to knowledge base
• Ask questions → search saved knowledge and answer
• Save memos with "저장해: ..." or "/memo ..."

${userName ? `User: ${userName}` : ""}
Saved documents: ${docCount} | Categories: ${categoryCount}
${recentDocs.length > 0 ? `Recently saved: ${recentDocs.join(", ")}` : ""}

CRITICAL RULES:
1. You MUST respond in ${langName}. Always match the user's language.
2. Be friendly, concise, and helpful.
3. ALWAYS respond — never return empty or refuse to answer.`;

  if (conversationHistory) {
    prompt += `\n\nRecent conversation:\n${conversationHistory}`;
  }

  if (context) {
    prompt += `\n\nReference documents:\n${context}\n\nCite sources as [1], [2] when using them.`;
  } else {
    prompt += `\n\nNo relevant saved documents found. Answer from general knowledge. Briefly mention that saving related content to SayKnowMind would enable more precise answers.`;
  }

  return prompt;
}

// ── User Context Helper ──────────────────────────────────────

async function getUserContext(userId: string) {
  const [docCountRes, recentRes, catCountRes, userRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int as count FROM documents WHERE user_id = $1`, [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pool.query(`SELECT title FROM documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`, [userId]).catch(() => ({ rows: [] })),
    pool.query(`SELECT COUNT(*)::int as count FROM categories WHERE user_id = $1`, [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pool.query(`SELECT name FROM "user" WHERE id = $1`, [userId]).catch(() => ({ rows: [] })),
  ]);

  return {
    docCount: docCountRes.rows[0]?.count ?? 0,
    recentDocs: recentRes.rows.map((r: { title: string }) => r.title),
    categoryCount: catCountRes.rows[0]?.count ?? 0,
    userName: (userRes.rows[0]?.name as string) ?? undefined,
  };
}

// ── AI Call (Cloud-first → AI server fallback) ───────────────

async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
  return await callAiCloudFirst({
    system: systemPrompt,
    message: userMessage,
    timeout: 60_000,
  });
}

// ── Job Completion Notifier ──────────────────────────────────

/**
 * Fire-and-forget: polls job status and sends a Telegram notification
 * when the ingestion job completes (summary, keywords, etc.).
 */
function notifyJobCompletion(
  botToken: string,
  chatId: number,
  userId: string,
  jobId: string,
  title: string,
  lang: Lang,
): void {
  const MAX_POLLS = 60;   // 60 * 3s = 180s max wait
  const INTERVAL = 3_000;
  let polls = 0;

  console.log(`[telegram] Starting job notification polling for ${jobId}`);

  const timer = setInterval(async () => {
    polls++;
    try {
      const status = await getJobStatus(jobId, userId);
      if (!status) {
        console.warn(`[telegram] Job ${jobId} not found — stopping poll`);
        clearInterval(timer);
        return;
      }

      if (status.status === "completed") {
        clearInterval(timer);
        console.log(`[telegram] Job ${jobId} completed after ${polls * 3}s — sending notification`);

        // Fetch the document summary from AI processing
        let summary = "";
        try {
          const doc = await pool.query(
            `SELECT LEFT(summary, 300) as excerpt FROM documents WHERE id = (
              SELECT document_id FROM ingestion_jobs WHERE id = $1
            )`,
            [jobId],
          );
          const excerpt = doc.rows[0]?.excerpt ?? "";
          summary = excerpt.length > 200 ? excerpt.slice(0, 200) + "..." : excerpt;
        } catch { /* non-critical */ }

        // Fallback: use content if no summary
        if (!summary) {
          try {
            const doc = await pool.query(
              `SELECT LEFT(content, 300) as excerpt FROM documents WHERE id = (
                SELECT document_id FROM ingestion_jobs WHERE id = $1
              )`,
              [jobId],
            );
            const excerpt = doc.rows[0]?.excerpt ?? "";
            summary = excerpt.length > 200 ? excerpt.slice(0, 200) + "..." : excerpt;
          } catch { /* non-critical */ }
        }

        await sendMessage(botToken, chatId,
          msg("jobDone", lang, { title, summary: summary || "✅" }));
      } else if (status.status === "failed") {
        clearInterval(timer);
        console.warn(`[telegram] Job ${jobId} failed: ${status.error ?? "unknown"}`);
        await sendMessage(botToken, chatId,
          msg("jobFailed", lang, { title }));
      } else if (polls >= MAX_POLLS) {
        clearInterval(timer);
        console.warn(`[telegram] Job ${jobId} polling timed out after ${MAX_POLLS * 3}s`);
      }
    } catch (err) {
      console.error(`[telegram] Job ${jobId} poll error:`, (err as Error).message);
      if (polls >= MAX_POLLS) clearInterval(timer);
    }
  }, INTERVAL);
}

// ── Telegram Conversation History ────────────────────────────

async function getOrCreateTelegramConversation(userId: string, tgUserId: string): Promise<string> {
  const tag = `telegram:${tgUserId}`;
  try {
    const existing = await pool.query(
      `SELECT id FROM conversations WHERE user_id = $1 AND title = $2 ORDER BY updated_at DESC LIMIT 1`,
      [userId, tag],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const created = await pool.query(
      `INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
      [userId, tag],
    );
    return created.rows[0].id;
  } catch {
    // If conversations table doesn't exist, return empty
    return "";
  }
}

async function loadConversationHistory(conversationId: string, limit = 10): Promise<{ role: string; content: string }[]> {
  if (!conversationId) return [];
  try {
    const result = await pool.query(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [conversationId, limit],
    );
    return result.rows.reverse();
  } catch {
    return [];
  }
}

async function saveMessage(conversationId: string, role: string, content: string): Promise<void> {
  if (!conversationId) return;
  try {
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [conversationId, role, content],
    );
    await pool.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId],
    );
  } catch { /* non-critical */ }
}

// ── Search Knowledge Base ────────────────────────────────────

async function searchKnowledge(userId: string, query: string): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const res = await fetch(`${appUrl}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ query, mode: "hybrid", limit: 3 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json();
      const results = data.results ?? [];
      if (results.length > 0) {
        return results.map((r: { title: string; snippet?: string }, i: number) =>
          `[${i + 1}] ${r.title}\n${(r.snippet ?? "").slice(0, 500)}`
        ).join("\n\n");
      }
    }
  } catch { /* search unavailable */ }

  // Fallback: simple SQL search
  try {
    const sqlRes = await pool.query(
      `SELECT title, LEFT(content, 300) as snippet FROM documents
       WHERE user_id = $1 AND (title ILIKE '%' || $2 || '%' OR content ILIKE '%' || $2 || '%')
       ORDER BY created_at DESC LIMIT 3`,
      [userId, query.split(/\s+/)[0]],
    );
    if (sqlRes.rows.length > 0) {
      return sqlRes.rows.map((r: { title: string; snippet: string }, i: number) =>
        `[${i + 1}] ${r.title}\n${r.snippet}`
      ).join("\n\n");
    }
  } catch { /* ignore */ }

  return "";
}

// ── Main Handler ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const fallbackToken = await getBotToken();
  if (!fallbackToken) {
    return NextResponse.json({ ok: false, error: "No bot token configured" }, { status: 503 });
  }

  // Verify webhook secret
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const msgType = classifyUpdate(update);

  // ── Callback Query (inline keyboard press) ──────────────
  if (msgType === "callback_query") {
    const cbq = update.callback_query!;
    const cbChatId = cbq.message!.chat.id;
    const cbMessageId = cbq.message!.message_id;
    const cbTgUserId = String(cbq.from.id);
    const { token: cbUserToken, lang: cbLang } = await getBotTokenForTelegramUser(cbTgUserId);
    const cbBotToken = cbUserToken ?? fallbackToken;

    const cbLinked = await pool.query(
      `SELECT user_id FROM channel_links WHERE channel = 'telegram' AND channel_user_id = $1`,
      [cbTgUserId],
    ).catch(() => ({ rows: [] }));
    const cbUserId = cbLinked.rows[0]?.user_id as string | undefined;

    if (!cbUserId) {
      await answerCallbackQuery(cbBotToken, cbq.id, msg("accountNotLinked", cbLang));
      return NextResponse.json({ ok: true });
    }

    const data = cbq.data ?? "";

    // ── Language selection callback ──
    if (data.startsWith("lang:")) {
      const chosen = data.split(":")[1] as Lang;
      if (SUPPORTED_LANGS.includes(chosen)) {
        await setUserLang(cbTgUserId, chosen);
        await answerCallbackQuery(cbBotToken, cbq.id, `✅ ${LANG_LABELS[chosen]}`);
        await editMessageText(cbBotToken, cbChatId, cbMessageId,
          `✅ ${msg("langSet", chosen)}`);
        await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);
      }
      return NextResponse.json({ ok: true });
    }

    if (data.startsWith("c:")) {
      try {
        const parts = data.split(":");
        const doc12 = parts[1];
        const cat12 = parts[2];

        const [docResult, catResult] = await Promise.all([
          pool.query(
            `SELECT id FROM documents WHERE id::text LIKE $1 || '%' AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
            [doc12, cbUserId],
          ),
          pool.query(
            `SELECT id, name FROM categories WHERE id::text LIKE $1 || '%' AND user_id = $2 LIMIT 1`,
            [cat12, cbUserId],
          ),
        ]);

        if (docResult.rows[0] && catResult.rows[0]) {
          await assignDocumentCategory(docResult.rows[0].id, catResult.rows[0].id);
          await answerCallbackQuery(cbBotToken, cbq.id, `✅ ${catResult.rows[0].name}`);
          const originalText = cbq.message?.text ?? "✅";
          await editMessageText(cbBotToken, cbChatId, cbMessageId,
            `${originalText}\n\n✅ ${msg("savedToCategory", cbLang, { name: catResult.rows[0].name })}`);
          await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);
        } else {
          await answerCallbackQuery(cbBotToken, cbq.id, msg("docOrCatNotFound", cbLang));
          await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);
        }
      } catch (err) {
        console.error("[telegram] Category callback error:", err);
        await answerCallbackQuery(cbBotToken, cbq.id, "❌ Error").catch(() => {});
        await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId).catch(() => {});
      }
    } else if (data.startsWith("skip:")) {
      await answerCallbackQuery(cbBotToken, cbq.id, "✅");
      const originalText = cbq.message?.text ?? "✅";
      await editMessageText(cbBotToken, cbChatId, cbMessageId,
        `${originalText}\n\n⏭ ${msg("skipped", cbLang)}`);
      await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);

    // ── Duplicate: save copy ──
    } else if (data.startsWith("dup:y:")) {
      const dupId = data.split(":")[2];
      const pending = pendingDups.get(dupId);
      pendingDups.delete(dupId);

      if (!pending || pending.userId !== cbUserId) {
        await answerCallbackQuery(cbBotToken, cbq.id, "❌ Expired");
        await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);
        return NextResponse.json({ ok: true });
      }

      try {
        const L = pending.lang;
        let newTitle = deduplicateName(pending.existingTitle);

        if (pending.type === "url" && pending.url) {
          const fetched = await fetchUrl(pending.url);
          const documentId = await insertDocument({
            userId: cbUserId, title: newTitle, content: fetched.content,
            url: pending.url, sourceType: "web",
            metadata: { wordCount: fetched.wordCount, language: L, source: "telegram", ...fetched.metadata },
          });
          const jobId = await createJob(cbUserId, documentId);
          await answerCallbackQuery(cbBotToken, cbq.id, "✅");
          await editMessageText(cbBotToken, cbChatId, cbMessageId, msg("dupSaved", L, { title: newTitle }));
          await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);
          const categories = await listCategories(cbUserId);
          if (categories.length > 0) {
            await sendMessage(cbBotToken, cbChatId, msg("urlSaved", L, { title: newTitle }), {
              replyMarkup: buildCategoryKeyboard(categories, documentId, L),
            });
          }
          notifyJobCompletion(cbBotToken, cbChatId, cbUserId, jobId, newTitle, L);

        } else if ((pending.type === "photo" || pending.type === "document") && pending.fileId) {
          const fileInfo = await getFile(cbBotToken, pending.fileId);
          if (!fileInfo) throw new Error("Cannot re-download file");
          const buffer = await downloadFile(cbBotToken, fileInfo.file_path);
          const newFileName = deduplicateName(pending.fileName ?? "file");
          newTitle = deduplicateName(pending.existingTitle);
          const mimeType = pending.mimeType ?? "application/octet-stream";
          const caption = pending.caption ?? "";

          let content = caption || (pending.type === "photo" ? "[image]" : `[file: ${newFileName}]`);
          try {
            const parsed = await parseFile(buffer, mimeType, newFileName);
            if (parsed.content) content = parsed.content;
          } catch { /* use caption */ }

          const fileType = pending.type === "photo" ? "image" : mimeType.split("/")[0];
          const documentId = await insertDocument({
            userId: cbUserId, title: newTitle, content, sourceType: "file",
            metadata: {
              wordCount: content.split(/\s+/).filter(Boolean).length,
              language: L, fileType, fileName: newFileName,
              fileSize: buffer.length, source: "telegram",
              ...(pending.type === "photo" && buffer.length < 5_000_000 ? { fileBase64: buffer.toString("base64") } : {}),
            },
          });
          const filePath = await saveFile(documentId, newFileName, buffer);
          await pool.query(
            `UPDATE documents SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
            [JSON.stringify({ filePath }), documentId],
          );
          const jobId = await createJob(cbUserId, documentId);
          await answerCallbackQuery(cbBotToken, cbq.id, "✅");
          await editMessageText(cbBotToken, cbChatId, cbMessageId, msg("dupSaved", L, { title: newTitle }));
          await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);
          const categories = await listCategories(cbUserId);
          if (categories.length > 0) {
            const savedMsg = pending.type === "photo" ? "photoSaved" : "fileSaved";
            await sendMessage(cbBotToken, cbChatId, msg(savedMsg, L, { title: newTitle }), {
              replyMarkup: buildCategoryKeyboard(categories, documentId, L),
            });
          }
          notifyJobCompletion(cbBotToken, cbChatId, cbUserId, jobId, newTitle, L);
        }
      } catch (err) {
        console.error("[telegram] Duplicate save error:", err);
        await answerCallbackQuery(cbBotToken, cbq.id, "❌ Error").catch(() => {});
        await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId).catch(() => {});
      }

    // ── Duplicate: cancel ──
    } else if (data.startsWith("dup:n:")) {
      const dupId = data.split(":")[2];
      pendingDups.delete(dupId);
      await answerCallbackQuery(cbBotToken, cbq.id, "✅");
      await editMessageText(cbBotToken, cbChatId, cbMessageId, msg("dupCancelled", cbLang));
      await editMessageReplyMarkup(cbBotToken, cbChatId, cbMessageId);
    }

    return NextResponse.json({ ok: true });
  }

  // ── Message handling ────────────────────────────────────
  const message = update.message;
  if (!message?.from) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const tgUserId = String(message.from.id);
  const text = message.text?.trim() ?? message.caption?.trim() ?? "";
  const { token: userToken, lang: userLang } = await getBotTokenForTelegramUser(tgUserId);
  const botToken = userToken ?? fallbackToken;
  const L = userLang;

  // Look up linked SayKnowMind user
  const linked = await pool.query(
    `SELECT user_id FROM channel_links WHERE channel = 'telegram' AND channel_user_id = $1`,
    [tgUserId],
  ).catch(() => ({ rows: [] }));
  let userId = linked.rows[0]?.user_id as string | undefined;

  // ── Commands ────────────────────────────────────────────

  if (msgType === "command") {
    // /start [linkCode]
    if (text.startsWith("/start")) {
      const linkCode = text.split(" ")[1];
      if (linkCode && !userId) {
        // Manual link with code from web settings
        const linkResult = await pool.query(
          `UPDATE channel_links
           SET channel_user_id = $1, channel_username = $2, linked_at = NOW()
           WHERE channel = 'telegram' AND link_code = $3 AND channel_user_id IS NULL
           RETURNING user_id`,
          [tgUserId, message.from.username ?? null, linkCode],
        ).catch(() => ({ rows: [] }));

        if (linkResult.rows.length > 0) {
          await sendMessage(botToken, chatId, msg("startLinked", L));
        } else {
          await sendMessage(botToken, chatId, msg("startBadCode", L));
        }
      } else if (userId) {
        await sendMessage(botToken, chatId, msg("startAlready", L));
      } else {
        // Auto-create account for new Telegram users
        try {
          const newUserId = crypto.randomUUID();
          const tgUsername = message.from.username ?? `tg_${tgUserId}`;
          const displayName = message.from.first_name || tgUsername;
          const autoEmail = `tg_${tgUserId}@telegram.sayknowmind.local`;

          await pool.query(
            `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, FALSE, NOW(), NOW())
             ON CONFLICT (email) DO NOTHING`,
            [newUserId, displayName, autoEmail],
          );

          // Check if insert succeeded or user already exists
          const userRow = await pool.query(
            `SELECT id FROM "user" WHERE email = $1`,
            [autoEmail],
          );
          const actualUserId = userRow.rows[0]?.id ?? newUserId;

          // Create channel_links entry
          await pool.query(
            `INSERT INTO channel_links (user_id, channel, channel_user_id, channel_username, linked_at)
             VALUES ($1, 'telegram', $2, $3, NOW())
             ON CONFLICT (user_id, channel) DO UPDATE
             SET channel_user_id = $2, channel_username = $3, linked_at = NOW()`,
            [actualUserId, tgUserId, message.from.username ?? null],
          );

          await sendMessage(botToken, chatId, msg("startAutoCreated", L));
        } catch (err) {
          console.error("[telegram] Auto-registration failed:", err);
          await sendMessage(botToken, chatId, msg("startWelcome", L, { tgId: tgUserId }));
        }
      }
      return NextResponse.json({ ok: true });
    }

    // /help
    if (text === "/help") {
      await sendMessage(botToken, chatId, msg("help", L));
      return NextResponse.json({ ok: true });
    }

    // /lang — language selection
    if (text === "/lang") {
      const keyboard: TelegramInlineKeyboardMarkup = {
        inline_keyboard: [
          SUPPORTED_LANGS.map((code) => ({
            text: `${code === L ? "✅ " : ""}${LANG_LABELS[code]}`,
            callback_data: `lang:${code}`,
          })),
        ],
      };
      await sendMessage(botToken, chatId, msg("langPrompt", L), { replyMarkup: keyboard });
      return NextResponse.json({ ok: true });
    }

    // /myid
    if (text === "/myid") {
      await sendMessage(botToken, chatId, msg("myId", L, { tgId: tgUserId }));
      return NextResponse.json({ ok: true });
    }

    // /unlink
    if (text === "/unlink" && userId) {
      await pool.query(
        `UPDATE channel_links SET channel_user_id = NULL, channel_username = NULL, linked_at = NULL
         WHERE channel = 'telegram' AND user_id = $1`,
        [userId],
      );
      await sendMessage(botToken, chatId, msg("unlinked", L));
      return NextResponse.json({ ok: true });
    }

    // /status
    if (text === "/status") {
      if (userId) {
        const docCount = await pool.query(`SELECT COUNT(*) FROM documents WHERE user_id = $1`, [userId]);
        const catCount = await pool.query(`SELECT COUNT(*) FROM categories WHERE user_id = $1`, [userId]);
        await sendMessage(botToken, chatId,
          msg("statusOk", L, { docs: docCount.rows[0]?.count ?? 0, cats: catCount.rows[0]?.count ?? 0 }));
      } else {
        await sendMessage(botToken, chatId, msg("statusNoLink", L));
      }
      return NextResponse.json({ ok: true });
    }

    // /recent
    if (text === "/recent" && userId) {
      const docs = await pool.query(
        `SELECT title, source_type, created_at FROM documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [userId],
      );
      if (docs.rows.length === 0) {
        await sendMessage(botToken, chatId, msg("noDocs", L));
      } else {
        const icons: Record<string, string> = { web: "🌐", file: "📄", text: "📝" };
        const list = docs.rows.map((d: { title: string; source_type: string }, i: number) =>
          `${i + 1}. ${icons[d.source_type] ?? "📄"} ${d.title}`
        ).join("\n");
        await sendMessage(botToken, chatId, `${msg("recentDocs", L)}\n\n${list}`);
      }
      return NextResponse.json({ ok: true });
    }

    // /categories
    if (text === "/categories" && userId) {
      const categories = await listCategories(userId);
      if (categories.length === 0) {
        await sendMessage(botToken, chatId, msg("noCats", L));
      } else {
        const list = categories.map((c, i) =>
          `${i + 1}. 📁 ${c.name}${c.depth > 0 ? ` (${c.path})` : ""}`
        ).join("\n");
        await sendMessage(botToken, chatId, `${msg("catList", L)}\n\n${list}`);
      }
      return NextResponse.json({ ok: true });
    }

    // /memo <text>
    if (text.startsWith("/memo ") && userId) {
      const content = text.slice(6).trim();
      if (!content) {
        await sendMessage(botToken, chatId, msg("memoUsage", L));
        return NextResponse.json({ ok: true });
      }

      await sendTyping(botToken, chatId);
      try {
        const title = content.slice(0, 80) + (content.length > 80 ? "..." : "");
        const wordCount = content.split(/\s+/).filter(Boolean).length + (L === "en" ? 0 : content.length);
        const documentId = await insertDocument({
          userId, title, content, sourceType: "text",
          metadata: { wordCount, language: L, source: "telegram" },
        });
        const jobId = await createJob(userId, documentId);

        const categories = await listCategories(userId);
        await sendMessage(botToken, chatId, msg("memoSaved", L, { title }), {
          replyToMessageId: message.message_id,
          replyMarkup: categories.length > 0 ? buildCategoryKeyboard(categories, documentId, L) : undefined,
        });
        notifyJobCompletion(botToken, chatId, userId, jobId, title, L);
      } catch {
        await sendMessage(botToken, chatId, msg("memoFail", L));
      }
      return NextResponse.json({ ok: true });
    }

    // /search <query>
    if (text.startsWith("/search ") && userId) {
      const query = text.slice(8).trim();
      if (!query) {
        await sendMessage(botToken, chatId, msg("searchUsage", L));
        return NextResponse.json({ ok: true });
      }

      await sendTyping(botToken, chatId);
      const context = await searchKnowledge(userId, query);
      if (context) {
        await sendMessage(botToken, chatId, `${msg("searchResults", L)}\n\n${context}`);
      } else {
        await sendMessage(botToken, chatId, msg("searchEmpty", L));
      }
      return NextResponse.json({ ok: true });
    }

    // Unknown command — not linked, suggest /start
    if (!userId) {
      await sendMessage(botToken, chatId, "👋 Send /start to create your account and get started!");
      return NextResponse.json({ ok: true });
    }
  }

  // ── Auto-register unlinked users for content operations ──

  if (!userId) {
    try {
      const newUserId = crypto.randomUUID();
      const tgUsername = message.from.username ?? `tg_${tgUserId}`;
      const displayName = message.from.first_name || tgUsername;
      const autoEmail = `tg_${tgUserId}@telegram.sayknowmind.local`;

      await pool.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, FALSE, NOW(), NOW())
         ON CONFLICT (email) DO NOTHING`,
        [newUserId, displayName, autoEmail],
      );
      const userRow = await pool.query(`SELECT id FROM "user" WHERE email = $1`, [autoEmail]);
      const actualUserId = userRow.rows[0]?.id ?? newUserId;

      await pool.query(
        `INSERT INTO channel_links (user_id, channel, channel_user_id, channel_username, linked_at)
         VALUES ($1, 'telegram', $2, $3, NOW())
         ON CONFLICT (user_id, channel) DO UPDATE
         SET channel_user_id = $2, channel_username = $3, linked_at = NOW()`,
        [actualUserId, tgUserId, message.from.username ?? null],
      );

      userId = actualUserId;
    } catch (err) {
      console.error("[telegram] Auto-registration failed:", err);
      await sendMessage(botToken, chatId, msg("linkFirstShort", L, { tgId: tgUserId }));
      return NextResponse.json({ ok: true });
    }
  }

  // Final guard — should never reach here, but satisfies TypeScript
  if (!userId) {
    return NextResponse.json({ ok: true });
  }

  // ── URL Ingestion (direct DB call) ──────────────────────

  if (msgType === "url") {
    const urls = extractUrls(update);
    const url = urls[0] ?? text;
    await sendTyping(botToken, chatId);

    try {
      // Duplicate check
      const existingUrl = await findDuplicateByUrl(userId, url);
      if (existingUrl) {
        const dupId = storePendingDup({ type: "url", userId, lang: L, url, existingTitle: existingUrl.title });
        await sendMessage(botToken, chatId, msg("dupFound", L, { title: existingUrl.title }), {
          replyToMessageId: message.message_id,
          replyMarkup: buildDupKeyboard(dupId, L),
        });
        return NextResponse.json({ ok: true });
      }

      const fetched = await fetchUrl(url);
      const title = fetched.title || new URL(url).hostname;
      const wordCount = fetched.wordCount || fetched.content.split(/\s+/).filter(Boolean).length;

      const documentId = await insertDocument({
        userId, title, content: fetched.content, url, sourceType: "web",
        metadata: { wordCount, language: L, source: "telegram", ...fetched.metadata },
      });
      const jobId = await createJob(userId, documentId);

      const categories = await listCategories(userId);
      await sendMessage(botToken, chatId, msg("urlSaved", L, { title }), {
        replyToMessageId: message.message_id,
        replyMarkup: categories.length > 0 ? buildCategoryKeyboard(categories, documentId, L) : undefined,
      });
      notifyJobCompletion(botToken, chatId, userId, jobId, title, L);
    } catch (err) {
      console.error("[telegram] URL ingest error:", err);
      await sendMessage(botToken, chatId, msg("urlFail", L));
    }
    return NextResponse.json({ ok: true });
  }

  // ── Photo Ingestion ─────────────────────────────────────

  if (msgType === "photo") {
    const photos = message.photo!;
    const largest = photos[photos.length - 1];
    await sendTyping(botToken, chatId);

    try {
      const fileInfo = await getFile(botToken, largest.file_id);
      if (!fileInfo) throw new Error("Cannot get file info");

      if (fileInfo.file_size && fileInfo.file_size > 20 * 1024 * 1024) {
        await sendMessage(botToken, chatId, msg("fileTooLarge", L));
        return NextResponse.json({ ok: true });
      }

      const fileName = fileInfo.file_path.split("/").pop() ?? "photo.jpg";
      const caption = message.caption ?? "";
      const title = caption || `${msg("imageLabel", L)} ${new Date().toLocaleDateString(L === "ko" ? "ko-KR" : L === "ja" ? "ja-JP" : L === "zh" ? "zh-CN" : "en-US")}`;

      // Duplicate check by fileName
      const existingPhoto = await findDuplicateByFileName(userId, fileName);
      if (existingPhoto) {
        const dupId = storePendingDup({
          type: "photo", userId, lang: L, fileId: largest.file_id,
          fileName, caption, mimeType: fileName.endsWith(".png") ? "image/png" : "image/jpeg",
          existingTitle: existingPhoto.title,
        });
        await sendMessage(botToken, chatId, msg("dupFound", L, { title: existingPhoto.title }), {
          replyToMessageId: message.message_id,
          replyMarkup: buildDupKeyboard(dupId, L),
        });
        return NextResponse.json({ ok: true });
      }

      const buffer = await downloadFile(botToken, fileInfo.file_path);
      const mimeType = fileName.endsWith(".png") ? "image/png" : "image/jpeg";

      let content = caption || "[image]";
      try {
        const parsed = await parseFile(buffer, mimeType, fileName);
        if (parsed.content) content = parsed.content;
      } catch { /* use caption as content */ }

      const documentId = await insertDocument({
        userId, title, content, sourceType: "file",
        metadata: {
          wordCount: content.split(/\s+/).filter(Boolean).length,
          language: L,
          fileType: "image",
          fileName,
          fileSize: buffer.length,
          source: "telegram",
          ...(buffer.length < 5_000_000 ? { fileBase64: buffer.toString("base64") } : {}),
        },
      });

      const filePath = await saveFile(documentId, fileName, buffer);
      // Store filePath in metadata so /api/files/[id] and preview work
      await pool.query(
        `UPDATE documents SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ filePath }), documentId],
      );
      const jobId = await createJob(userId, documentId);

      const categories = await listCategories(userId);
      await sendMessage(botToken, chatId, msg("photoSaved", L, { title }), {
        replyToMessageId: message.message_id,
        replyMarkup: categories.length > 0 ? buildCategoryKeyboard(categories, documentId, L) : undefined,
      });
      notifyJobCompletion(botToken, chatId, userId, jobId, title, L);
    } catch (err) {
      console.error("[telegram] Photo ingest error:", err);
      await sendMessage(botToken, chatId, msg("photoFail", L));
    }
    return NextResponse.json({ ok: true });
  }

  // ── Document/File Ingestion ─────────────────────────────

  if (msgType === "document") {
    const doc = message.document!;
    await sendTyping(botToken, chatId);

    try {
      if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
        await sendMessage(botToken, chatId, msg("fileTooLargeUpload", L));
        return NextResponse.json({ ok: true });
      }

      const fileName = doc.file_name ?? "file";
      const mimeType = doc.mime_type ?? "application/octet-stream";
      const caption = message.caption ?? "";

      // Duplicate check by fileName
      const existingDoc = await findDuplicateByFileName(userId, fileName);
      if (existingDoc) {
        const dupId = storePendingDup({
          type: "document", userId, lang: L, fileId: doc.file_id,
          fileName, caption, mimeType, existingTitle: existingDoc.title,
        });
        await sendMessage(botToken, chatId, msg("dupFound", L, { title: existingDoc.title }), {
          replyToMessageId: message.message_id,
          replyMarkup: buildDupKeyboard(dupId, L),
        });
        return NextResponse.json({ ok: true });
      }

      const fileInfo = await getFile(botToken, doc.file_id);
      if (!fileInfo) throw new Error("Cannot get file info");

      const buffer = await downloadFile(botToken, fileInfo.file_path);

      let content = caption || `[file: ${fileName}]`;
      let title = caption || fileName;

      try {
        const parsed = await parseFile(buffer, mimeType, fileName);
        if (parsed.content) content = parsed.content;
        if (parsed.title) title = parsed.title;
      } catch {
        // Unsupported format — still save the file
      }

      const documentId = await insertDocument({
        userId, title, content, sourceType: "file",
        metadata: {
          wordCount: content.split(/\s+/).filter(Boolean).length,
          language: L,
          fileType: mimeType.split("/")[0],
          fileName,
          fileSize: buffer.length,
          mimeType,
          source: "telegram",
        },
      });

      const filePath = await saveFile(documentId, fileName, buffer);
      // Store filePath in metadata so /api/files/[id] and preview work
      await pool.query(
        `UPDATE documents SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ filePath }), documentId],
      );
      const jobId = await createJob(userId, documentId);

      const categories = await listCategories(userId);
      await sendMessage(botToken, chatId, msg("fileSaved", L, { title }), {
        replyToMessageId: message.message_id,
        replyMarkup: categories.length > 0 ? buildCategoryKeyboard(categories, documentId, L) : undefined,
      });
      notifyJobCompletion(botToken, chatId, userId, jobId, title, L);
    } catch (err) {
      console.error("[telegram] Document ingest error:", err);
      await sendMessage(botToken, chatId, msg("fileFail", L));
    }
    return NextResponse.json({ ok: true });
  }

  // ── Text Memo Save ("저장해: ...", "메모: ...") ─────────

  if (msgType === "save_text") {
    const content = text.replace(/^(저장해|메모|save|memo|기록|노트|note)[:\s]+/i, "").trim();
    if (!content) {
      await sendMessage(botToken, chatId, msg("saveTextEmpty", L));
      return NextResponse.json({ ok: true });
    }

    await sendTyping(botToken, chatId);
    try {
      const title = content.slice(0, 80) + (content.length > 80 ? "..." : "");
      const wordCount = content.split(/\s+/).filter(Boolean).length + (L === "en" ? 0 : content.length);
      const documentId = await insertDocument({
        userId, title, content, sourceType: "text",
        metadata: { wordCount, language: L, source: "telegram" },
      });
      const jobId = await createJob(userId, documentId);

      const categories = await listCategories(userId);
      await sendMessage(botToken, chatId, msg("memoSaved", L, { title }), {
        replyToMessageId: message.message_id,
        replyMarkup: categories.length > 0 ? buildCategoryKeyboard(categories, documentId, L) : undefined,
      });
      notifyJobCompletion(botToken, chatId, userId, jobId, title, L);
    } catch {
      await sendMessage(botToken, chatId, msg("saveTextFail", L));
    }
    return NextResponse.json({ ok: true });
  }

  // ── AI Chat (RAG search → conversation history → AI answer) ──

  await sendTyping(botToken, chatId);

  try {
    const [context, userCtx, convId] = await Promise.all([
      searchKnowledge(userId, text),
      getUserContext(userId),
      getOrCreateTelegramConversation(userId, tgUserId),
    ]);

    // Load conversation history and build context string
    const history = await loadConversationHistory(convId, 8);
    const conversationHistory = history.length > 0
      ? history.map((m) => `${m.role}: ${m.content.slice(0, 300)}`).join("\n")
      : undefined;

    // Save user message
    await saveMessage(convId, "user", text);

    const systemPrompt = buildSystemPrompt({
      context,
      ...userCtx,
      lang: L,
      conversationHistory,
    });

    let answer = await callAI(systemPrompt, text);

    // Always respond — fallback messages in user's language
    if (!answer && context) {
      answer = `${msg("aiFallbackSearch", L)}\n\n${context}`;
    } else if (!answer) {
      answer = msg("aiUnavailable", L);
    }

    if (answer.length > 4000) answer = answer.slice(0, 4000) + "\n\n[...truncated]";
    await sendMessage(botToken, chatId, answer, { replyToMessageId: message.message_id });

    // Save assistant response to conversation history
    await saveMessage(convId, "assistant", answer);
  } catch (err) {
    console.error("[telegram] AI chat error:", err);
    await sendMessage(botToken, chatId, msg("aiError", L));
  }

  return NextResponse.json({ ok: true });
}
