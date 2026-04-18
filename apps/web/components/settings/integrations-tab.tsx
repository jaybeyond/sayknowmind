"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "@/lib/i18n";
import { Send, MessageSquare, Gamepad2, Mail, CheckCircle2, XCircle, ChevronDown, ChevronUp, Radio } from "lucide-react";

type ChannelId = "telegram" | "slack" | "discord" | "email";

interface ChannelConfig {
  id: ChannelId;
  nameKey: string;
  descKey: string;
  icon: typeof Send;
  tokenPlaceholder: string;
  docsUrl: string;
  extraFields?: { key: string; label: string; placeholder: string }[];
}

interface ChannelStatus {
  configured: boolean;
  linked: boolean;
  linkCode: string | null;
  username: string | null;
  linkedAt: string | null;
  botName: string | null;
  webhookActive: boolean;
}

interface VerifyResult {
  valid: boolean;
  botName?: string;
  botUsername?: string;
  error?: string;
  saved?: boolean;
}

const CHANNELS: ChannelConfig[] = [
  {
    id: "telegram", nameKey: "integrations.telegramTitle", descKey: "integrations.telegramDesc",
    icon: Send, tokenPlaceholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    docsUrl: "https://core.telegram.org/bots#botfather",
  },
  {
    id: "slack", nameKey: "integrations.slackTitle", descKey: "integrations.slackDesc",
    icon: MessageSquare, tokenPlaceholder: "xoxb-your-slack-bot-token",
    docsUrl: "https://api.slack.com/start",
    extraFields: [{ key: "SLACK_SIGNING_SECRET", label: "Signing Secret", placeholder: "your-signing-secret" }],
  },
  {
    id: "discord", nameKey: "integrations.discordTitle", descKey: "integrations.discordDesc",
    icon: Gamepad2, tokenPlaceholder: "your-discord-bot-token",
    docsUrl: "https://discord.com/developers/applications",
  },
  {
    id: "email", nameKey: "integrations.emailTitle", descKey: "integrations.emailDesc",
    icon: Mail, tokenPlaceholder: "smtp.gmail.com", docsUrl: "",
    extraFields: [
      { key: "EMAIL_SMTP_PORT", label: "Port", placeholder: "587" },
      { key: "EMAIL_SMTP_USER", label: "User", placeholder: "you@example.com" },
      { key: "EMAIL_SMTP_PASS", label: "Password", placeholder: "app-password" },
    ],
  },
];

export function IntegrationsTab() {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<ChannelId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({});
  const [polling, setPolling] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    setPolling(true);
    const doPoll = async () => {
      try {
        const res = await fetch("/api/integrations/telegram/poll", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          if (data.processed > 0) setPollCount((c) => c + data.processed);
        }
      } catch { /* silent */ }
    };
    doPoll();
    pollRef.current = setInterval(doPoll, 3000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPolling(false);
  }, []);

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const fetchStatuses = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled(
        CHANNELS.map(async (ch) => {
          const res = await fetch(`/api/integrations/${ch.id}`);
          if (!res.ok) return { id: ch.id, data: null };
          return { id: ch.id, data: (await res.json()) as ChannelStatus };
        }),
      );
      const s: Record<string, ChannelStatus> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.data) s[r.value.id] = r.value.data;
      }
      setStatuses(s);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  // Verify token → show result → if valid, save to DB
  const handleVerify = async (channelId: ChannelId) => {
    const token = tokens[channelId];
    if (!token) return;
    const key = `${channelId}-verify`;
    setBusy(key);
    setVerifyResults((prev) => ({ ...prev, [channelId]: undefined as unknown as VerifyResult }));
    try {
      const res = await fetch(`/api/integrations/${channelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verifyAndSave", token }),
      });
      const data: VerifyResult = await res.json();
      setVerifyResults((prev) => ({ ...prev, [channelId]: data }));
      if (data.valid) await fetchStatuses();
    } catch {
      setVerifyResults((prev) => ({ ...prev, [channelId]: { valid: false, error: "Network error" } }));
    } finally { setBusy(null); }
  };

  const doAction = async (channelId: ChannelId, action: string) => {
    const key = `${channelId}-${action}`;
    setBusy(key);
    try {
      const res = await fetch(`/api/integrations/${channelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (action === "generateLinkCode" && data.linkCode) {
        setCodes((prev) => ({ ...prev, [channelId]: data.linkCode }));
      }
      await fetchStatuses();
    } catch { /* silent */ } finally { setBusy(null); }
  };

  const unlinkChannel = async (channelId: ChannelId) => {
    setBusy(`${channelId}-unlink`);
    try {
      await fetch(`/api/integrations/${channelId}`, { method: "DELETE" });
      await fetchStatuses();
    } catch { /* silent */ } finally { setBusy(null); }
  };

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground text-sm">{t("integrations.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t("integrations.channelsTitle")}</h3>
        <p className="text-xs text-muted-foreground mb-4">{t("integrations.channelsDesc")}</p>
      </div>

      <div className="grid gap-3">
        {CHANNELS.map((ch) => {
          const st = statuses[ch.id];
          const isOpen = expanded === ch.id;
          const configured = st?.configured ?? false;
          const linked = st?.linked ?? false;
          const code = codes[ch.id] ?? st?.linkCode ?? null;
          const vr = verifyResults[ch.id];

          return (
            <div key={ch.id} className="rounded-lg border overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : ch.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ch.icon className="size-5 text-muted-foreground" />
                  <div className="text-left">
                    <span className="text-sm font-medium">{t(ch.nameKey)}</span>
                    <p className="text-xs text-muted-foreground">{t(ch.descKey)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {configured ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <span className={`h-2 w-2 rounded-full ${linked ? "bg-green-500" : "bg-yellow-500"}`} />
                      {linked ? t("integrations.connected") : t("integrations.configured")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-gray-300" />
                      {t("integrations.notConfigured")}
                    </span>
                  )}
                  {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                </div>
              </button>

              {isOpen && (
                <div className="border-t px-4 py-4 space-y-4 bg-muted/20">
                  {/* Token input + verify */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium">{t("integrations.botToken")}</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder={ch.tokenPlaceholder}
                        value={tokens[ch.id] ?? ""}
                        onChange={(e) => setTokens((prev) => ({ ...prev, [ch.id]: e.target.value }))}
                        className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs"
                      />
                      <button
                        onClick={() => handleVerify(ch.id)}
                        disabled={busy === `${ch.id}-verify` || !tokens[ch.id]}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {busy === `${ch.id}-verify` ? t("integrations.verifying") : t("integrations.verify")}
                      </button>
                    </div>

                    {/* Verify result feedback */}
                    {vr && (
                      <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${vr.valid ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>
                        {vr.valid ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                        {vr.valid
                          ? `${t("integrations.tokenValid")} — @${vr.botUsername ?? vr.botName ?? "bot"}`
                          : `${t("integrations.tokenInvalid")}: ${vr.error ?? "Unknown error"}`}
                      </div>
                    )}

                    {ch.docsUrl && (
                      <a href={ch.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                        {t("integrations.howToSetup")} →
                      </a>
                    )}
                  </div>

                  {/* Extra fields */}
                  {ch.extraFields?.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <label className="text-xs font-medium">{f.label}</label>
                      <input type="text" placeholder={f.placeholder} className="w-full rounded-md border bg-background px-3 py-1.5 text-xs" />
                    </div>
                  ))}

                  {/* Bot status + webhook + link (only when configured) */}
                  {configured && (
                    <div className="space-y-3 border-t pt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{t("integrations.botStatus")}</span>
                        <span className="text-xs">{st?.botName ? `@${st.botName}` : t("integrations.configured")}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{t("integrations.webhook")}</span>
                        {st?.webhookActive ? (
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="text-xs">{t("integrations.active")}</span>
                            <button onClick={() => doAction(ch.id, "removeWebhook")} disabled={busy === `${ch.id}-removeWebhook`} className="text-xs text-red-500 hover:underline">{t("integrations.remove")}</button>
                          </div>
                        ) : (
                          <button onClick={() => doAction(ch.id, "setupWebhook")} disabled={busy === `${ch.id}-setupWebhook`} className="text-xs text-primary hover:underline">{t("integrations.setupWebhook")}</button>
                        )}
                      </div>

                      {/* Polling mode for local dev (webhook can't reach localhost) */}
                      {ch.id === "telegram" && isLocalhost && !st?.webhookActive && (
                        <div className="flex items-center justify-between rounded-md bg-amber-50 dark:bg-amber-950 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Radio className="size-4 text-amber-600" />
                            <div>
                              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{t("integrations.pollingMode")}</span>
                              <p className="text-[10px] text-amber-600 dark:text-amber-400">{t("integrations.pollingDesc")}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {polling && pollCount > 0 && (
                              <span className="text-[10px] text-amber-600">{pollCount} msgs</span>
                            )}
                            <button
                              onClick={polling ? stopPolling : startPolling}
                              className={`rounded-md px-3 py-1 text-xs font-medium ${polling ? "bg-red-500 text-white hover:bg-red-600" : "bg-amber-500 text-white hover:bg-amber-600"}`}
                            >
                              {polling ? t("integrations.stopPolling") : t("integrations.startPolling")}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="border-t pt-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium">{t("integrations.accountLink")}</span>
                          {linked ? (
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-green-500" />
                              <span className="text-xs">{st?.username ? `@${st.username}` : t("integrations.connected")}</span>
                              <button onClick={() => unlinkChannel(ch.id)} disabled={busy === `${ch.id}-unlink`} className="text-xs text-red-500 hover:underline">{t("integrations.unlink")}</button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("integrations.notLinked")}</span>
                          )}
                        </div>
                        {!linked && (
                          <div className="space-y-3">
                            {/* Method 1: Link code */}
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">{t("integrations.linkMethod1")}</p>
                              <button onClick={() => doAction(ch.id, "generateLinkCode")} disabled={busy === `${ch.id}-generateLinkCode`} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{t("integrations.generateCode")}</button>
                              {code && (
                                <div className="rounded bg-muted p-2">
                                  <p className="text-xs text-muted-foreground mb-1">{t("integrations.linkInstructions")}</p>
                                  <code className="text-xs font-mono select-all">/start {code}</code>
                                </div>
                              )}
                            </div>
                            {/* Method 2: Direct ID input */}
                            <div className="space-y-2 border-t pt-2">
                              <p className="text-xs text-muted-foreground">{t("integrations.linkMethod2")}</p>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder={t("integrations.userIdPlaceholder")}
                                  value={tokens[`${ch.id}-uid`] ?? ""}
                                  onChange={(e) => setTokens((prev) => ({ ...prev, [`${ch.id}-uid`]: e.target.value }))}
                                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs"
                                />
                                <button
                                  onClick={async () => {
                                    const uid = tokens[`${ch.id}-uid`];
                                    if (!uid) return;
                                    setBusy(`${ch.id}-linkById`);
                                    try {
                                      await fetch(`/api/integrations/${ch.id}`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ action: "linkByUserId", channelUserId: uid }),
                                      });
                                      await fetchStatuses();
                                    } catch { /* silent */ } finally { setBusy(null); }
                                  }}
                                  disabled={busy === `${ch.id}-linkById` || !tokens[`${ch.id}-uid`]}
                                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                >
                                  {t("integrations.linkById")}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
