"use client";

/**
 * Codex (ChatGPT subscription) status card for the AI settings tab.
 *
 * Polls /api/integrations/codex/status to surface whether `codex login` has
 * been run on the local machine. The card is only useful in the desktop /
 * Tauri build — on cloud deployments the readiness will always be false
 * (the server has no per-user ~/.codex/auth.json), so we render a short
 * "desktop only" note instead of a misleading "not signed in" state.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Bot, CheckCircle2, RefreshCw, ExternalLink, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

/**
 * Read Codex readiness from the local machine.
 *
 * In a full desktop build the Next.js server IS the local machine, so the
 * /api/integrations/codex/status route can answer truthfully. In lite the
 * server lives in the cloud and would always say `ready: false`, so we
 * prefer the Tauri `codex_status` invoke command when the runtime exposes
 * it. We fall back to the API for plain browser dev.
 */
interface TauriInvoke {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function tauriBridge(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInvoke }).__TAURI_INTERNALS__ ?? null;
}

async function fetchCodexReady(): Promise<boolean> {
  const bridge = tauriBridge();
  if (bridge?.invoke) {
    try {
      const result = await bridge.invoke<{ ready: boolean }>("codex_status");
      return Boolean(result?.ready);
    } catch {
      /* fall through */
    }
  }
  const res = await fetch("/api/integrations/codex/status");
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.ready);
}

/**
 * Kick off the OAuth flow. Tauri builds spawn `codex login` directly on the
 * user's machine; browser/dev falls back to the legacy API route which only
 * works when the Next.js server is on the same host as the user.
 */
async function startCodexLogin(): Promise<{ ok: boolean; error?: string }> {
  const bridge = tauriBridge();
  if (bridge?.invoke) {
    try {
      await bridge.invoke("exec_codex_login");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const res = await fetch("/api/integrations/codex/login", { method: "POST" });
  if (!res.ok && res.status !== 202) {
    const body = await res.json().catch(() => ({}));
    // Leave the localized fallback to the calling component, which has access
    // to the i18n hook. Callers should `?? t("settings.codex.loginStartFailed")`.
    return { ok: false, error: body.error };
  }
  return { ok: true };
}

export function CodexStatusCard() {
  const { t } = useTranslation();
  const [ready, setReady] = useState<boolean | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // `ready` from the local machine (Tauri-aware), `active` from the
      // cloud/server-side DB (user_provider_configs). We still hit the
      // API for the active flag because that's where it's persisted.
      const [localReady, apiRes] = await Promise.all([
        fetchCodexReady(),
        fetch("/api/integrations/codex/status").catch(() => null),
      ]);
      setReady(localReady);
      if (apiRes?.ok) {
        const data = await apiRes.json();
        setActive(Boolean(data.active));
      } else {
        setActive(false);
      }
    } catch {
      setReady(false);
      setActive(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(async () => {
    setToggling(true);
    setErrorMsg(null);
    try {
      const next = !active;
      // In lite/cloud-webview builds the API runs on the cloud host, which
      // has no ~/.codex/auth.json — its readiness check always returns false
      // and rejects activation with 412. Confirm readiness locally first and
      // pass the verdict so the server can trust the desktop side.
      const localReady = next ? await fetchCodexReady() : true;
      const res = await fetch("/api/integrations/codex/status", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: next ? JSON.stringify({ clientReady: localReady }) : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? t("settings.codex.toggleFailed"));
        return;
      }
      const data = await res.json();
      setReady(Boolean(data.ready));
      setActive(Boolean(data.active));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t("settings.codex.networkError"));
    } finally {
      setToggling(false);
    }
  }, [active, t]);

  useEffect(() => {
    void refresh();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [refresh]);

  const startLogin = useCallback(async () => {
    setLoggingIn(true);
    setErrorMsg(null);
    try {
      const launched = await startCodexLogin();
      if (!launched.ok) {
        setErrorMsg(launched.error ?? t("settings.codex.loginStartFailed"));
        setLoggingIn(false);
        return;
      }
      // CLI is now running and has popped the browser. Poll /status
      // every 2s until ready=true (or the user gives up).
      if (pollTimer.current) clearInterval(pollTimer.current);
      const start = Date.now();
      pollTimer.current = setInterval(async () => {
        try {
          const localReady = await fetchCodexReady();
          if (localReady) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            pollTimer.current = null;
            setReady(true);
            // Pick up the cloud active flag for completeness; failure here
            // doesn't matter because the next refresh will repair state.
            try {
              const s = await fetch("/api/integrations/codex/status");
              const sd = await s.json();
              setActive(Boolean(sd.active));
            } catch { /* ignore */ }
            setLoggingIn(false);
          } else if (Date.now() - start > 5 * 60 * 1000) {
            // 5-minute giveup; user can retry from the button.
            if (pollTimer.current) clearInterval(pollTimer.current);
            pollTimer.current = null;
            setLoggingIn(false);
            setErrorMsg(t("settings.codex.loginTimeout"));
          }
        } catch {
          /* keep polling — transient errors are fine */
        }
      }, 2000);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t("settings.codex.networkError"));
      setLoggingIn(false);
    }
  }, [t]);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="size-4" />
            {t("settings.codex.title")}
            {ready && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                <CheckCircle2 className="size-3" />
                {t("settings.codex.ready")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("settings.codex.description")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          aria-label={t("settings.codex.refresh")}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="mt-3 text-xs text-muted-foreground">{t("settings.codex.checking")}</div>
      ) : ready ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {active
                ? t("settings.codex.activeNote")
                : t("settings.codex.readyNote")}
            </span>
            <Button
              size="sm"
              variant={active ? "outline" : "default"}
              onClick={toggle}
              disabled={toggling}
            >
              {toggling
                ? t("settings.codex.toggling")
                : active
                  ? t("settings.codex.disconnect")
                  : t("settings.codex.connect")}
            </Button>
          </div>
          {errorMsg && (
            <p className="text-xs text-red-500">{errorMsg}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {loggingIn
              ? t("settings.codex.loggingIn")
              : t("settings.codex.notReady")}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={startLogin}
              disabled={loggingIn}
              className="whitespace-nowrap"
            >
              <LogIn className="size-3.5 mr-1 shrink-0" />
              <span className="whitespace-nowrap">
                {loggingIn ? t("settings.codex.loginWaiting") : t("settings.codex.loginButton")}
              </span>
            </Button>
            <a
              href="https://developers.openai.com/codex/auth"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              {t("settings.codex.guide")}
              <ExternalLink className="size-3" />
            </a>
          </div>
          {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}
