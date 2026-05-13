"use client";

/**
 * Cloud connectors section. Renders one card per provider returned by
 * GET /api/integrations/connectors. Each card has:
 *   - Connect button (redirects to OAuth)
 *   - One row per already-connected account, with Browse / Disconnect
 *
 * Per-user isolation: every API the UI calls only sees the current
 * session's user. The UI never references another user's data.
 */

import { useState, useEffect, useCallback } from "react";
import { Cloud, Plus, FolderOpen, Trash2, RefreshCw, CheckCircle2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { ConnectorBrowserDialog } from "./connector-browser-dialog";

interface ConnectedAccountDto {
  accountId: string;
  email?: string;
  label?: string;
  scope?: string;
  connectedAt: string;
}

interface ConnectorDto {
  id: string;
  displayName: string;
  description: string;
  scopes: readonly string[];
  supportsBrowse: boolean;
  supportsExport: boolean;
  connectedAccountCount: number;
  accounts: ConnectedAccountDto[];
}

export function CloudConnectorsSection() {
  const { t } = useTranslation();
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [browser, setBrowser] = useState<{ providerId: string; account: ConnectedAccountDto; displayName: string } | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/connectors");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setConnectors(data.connectors ?? []);
    } catch (err) {
      console.error("[connectors] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // After OAuth callback we land on /settings?tab=integrations&connect=ok|error
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    if (connect === "ok") {
      setBannerMessage({ type: "ok", text: t("integrations.ccAccountConnected") });
      void load();
    } else if (connect === "error") {
      // URLSearchParams.get already percent-decodes — no need for decodeURIComponent.
      // The server message is in English (likely from a Google API), surfaced as-is.
      const message = params.get("message") ?? t("integrations.ccConnectionFailed");
      setBannerMessage({ type: "error", text: message });
    }
    if (connect) {
      // Strip the params so reload doesn't re-show the banner
      const url = new URL(window.location.href);
      url.searchParams.delete("connect");
      url.searchParams.delete("message");
      window.history.replaceState({}, "", url.toString());
    }
  }, [load]);

  /**
   * Desktop OAuth flow — open Google's consent page in the user's
   * system browser (where its post-allow JavaScript reliably reflows
   * and the redirect chain actually completes) and poll our own
   * /accounts endpoint until the new account materialises. Falls back
   * to the regular full-page redirect when not running inside Tauri.
   */
  const tauriInvoke = ((): undefined | (<T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>) => {
    if (typeof window === "undefined") return undefined;
    return (window as unknown as { __TAURI_INTERNALS__?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } })
      .__TAURI_INTERNALS__?.invoke;
  })();

  const handleConnect = async (providerId: string) => {
    if (!tauriInvoke) {
      // Plain-browser path — stays inside the tab via 302 chain.
      window.location.href = `/api/integrations/connectors/${providerId}/oauth/start`;
      return;
    }

    setBannerMessage({ type: "ok", text: t("integrations.ccConnecting") || "Opening browser…" });
    try {
      // Ask the server for the OAuth URL without following the redirect.
      const startRes = await fetch(`/api/integrations/connectors/${providerId}/oauth/start?desktop=1`);
      if (!startRes.ok) {
        const body = await startRes.json().catch(() => ({}));
        setBannerMessage({ type: "error", text: (body as { error?: string }).error ?? `oauth/start ${startRes.status}` });
        return;
      }
      const { authUrl } = (await startRes.json()) as { authUrl: string };
      if (!authUrl) {
        setBannerMessage({ type: "error", text: "no auth URL" });
        return;
      }
      // Hand the URL to the system browser via the Tauri command.
      await tauriInvoke("open_external_url", { url: authUrl });

      // Poll /accounts every 2.5s, looking for the new account. The
      // server-side callback fires whenever the user finishes in their
      // browser — even if they're not logged into sayknowmind there
      // (state-only auth path).
      const deadline = Date.now() + 5 * 60 * 1000; // 5 min
      const beforeCount =
        connectors.find((c) => c.id === providerId)?.accounts.length ?? 0;
      const pollOnce = async (): Promise<boolean> => {
        const r = await fetch(`/api/integrations/connectors/${providerId}/accounts`);
        if (!r.ok) return false;
        const data = (await r.json()) as { accounts: Array<{ accountId: string }> };
        if (data.accounts.length > beforeCount) {
          await load();
          setBannerMessage({ type: "ok", text: t("integrations.ccConnected") || "Connected." });
          return true;
        }
        return false;
      };
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        if (await pollOnce()) return;
      }
      setBannerMessage({ type: "error", text: t("integrations.ccTimeout") || "Timed out waiting for browser approval." });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : "connect_failed",
      });
    }
  };

  const handleDisconnect = async (providerId: string, accountId: string) => {
    const res = await fetch(
      `/api/integrations/connectors/${providerId}/accounts/${encodeURIComponent(accountId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setBannerMessage({ type: "error", text: t("integrations.ccDisconnectFailed") });
      return;
    }
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Cloud className="size-4" />
            {t("integrations.ccTitle")}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t("integrations.ccDesc")}
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          aria-label={t("integrations.refresh")}
        >
          <RefreshCw className="size-3.5" />
          {t("integrations.refresh")}
        </button>
      </div>

      {bannerMessage && (
        <div
          className={`text-xs rounded-md border px-3 py-2 ${
            bannerMessage.type === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {bannerMessage.text}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground">{t("integrations.ccLoading")}</div>
      ) : connectors.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("integrations.ccNone")}</div>
      ) : (
        <div className="space-y-3">
          {connectors.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>{c.displayName}</span>
                    {c.connectedAccountCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        {c.connectedAccountCount} {t("integrations.ccConnected")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
                </div>
                <button
                  onClick={() => handleConnect(c.id)}
                  className="text-xs rounded-md border border-border bg-card hover:bg-accent px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="size-3.5" />
                  {c.connectedAccountCount > 0 ? t("integrations.ccAddAnother") : t("integrations.ccConnect")}
                </button>
              </div>

              {c.accounts.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {c.accounts.map((a) => (
                    <li
                      key={a.accountId}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{a.email ?? a.label ?? a.accountId}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {t("integrations.ccConnectedAt")} {new Date(a.connectedAt).toLocaleDateString()}
                        </div>
                      </div>
                      {c.supportsBrowse && (
                        <button
                          onClick={() =>
                            setBrowser({ providerId: c.id, account: a, displayName: c.displayName })
                          }
                          className="rounded-md border border-border bg-card hover:bg-accent px-2.5 py-1 inline-flex items-center gap-1.5 shrink-0"
                        >
                          <FolderOpen className="size-3" />
                          {t("integrations.ccBrowse")}
                        </button>
                      )}
                      <button
                        onClick={() => handleDisconnect(c.id, a.accountId)}
                        className="rounded-md border border-border bg-card hover:bg-red-500/20 hover:text-red-400 px-2.5 py-1 inline-flex items-center gap-1.5 shrink-0"
                        aria-label={`${t("integrations.ccDisconnect")} ${a.email ?? a.accountId}`}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {browser && (
        <ConnectorBrowserDialog
          providerId={browser.providerId}
          account={browser.account}
          displayName={browser.displayName}
          onClose={() => setBrowser(null)}
          onImported={() => {
            // Optional: refresh connector list (not strictly needed)
          }}
        />
      )}
    </div>
  );
}
