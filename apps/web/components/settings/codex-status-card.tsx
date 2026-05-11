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

/**
 * Read Codex readiness from the local machine.
 *
 * In a full desktop build the Next.js server IS the local machine, so the
 * /api/integrations/codex/status route can answer truthfully. In lite the
 * server lives in the cloud and would always say `ready: false`, so we
 * prefer the Tauri `codex_status` invoke command when the runtime exposes
 * it. We fall back to the API for plain browser dev.
 */
async function fetchCodexReady(): Promise<boolean> {
  // Tauri's JS bridge: window.__TAURI_INTERNALS__.invoke exists in any
  // build (full or lite). Detect at call time so SSR doesn't trip up.
  const w = typeof window !== "undefined"
    ? (window as unknown as {
        __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<unknown> };
      })
    : null;
  if (w?.__TAURI_INTERNALS__?.invoke) {
    try {
      const result = (await w.__TAURI_INTERNALS__.invoke("codex_status")) as { ready: boolean };
      return Boolean(result?.ready);
    } catch {
      // Fall through to API — the command might not be registered in older builds.
    }
  }
  const res = await fetch("/api/integrations/codex/status");
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.ready);
}

export function CodexStatusCard() {
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
      const res = await fetch("/api/integrations/codex/status", {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? "토글 실패");
        return;
      }
      const data = await res.json();
      setReady(Boolean(data.ready));
      setActive(Boolean(data.active));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "네트워크 오류");
    } finally {
      setToggling(false);
    }
  }, [active]);

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
      const res = await fetch("/api/integrations/codex/login", { method: "POST" });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? "로그인 시작 실패");
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
            setErrorMsg("로그인 대기 시간 초과 — 다시 시도해주세요.");
          }
        } catch {
          /* keep polling — transient errors are fine */
        }
      }, 2000);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "네트워크 오류");
      setLoggingIn(false);
    }
  }, []);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="size-4" />
            ChatGPT 구독 (Codex)
            {ready && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                <CheckCircle2 className="size-3" />
                인증됨
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            본인 ChatGPT Plus/Pro/Business/Edu/Enterprise 구독으로 OpenAI 모델 호출. API 키 불필요, 호출 비용 0.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          aria-label="새로고침"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="mt-3 text-xs text-muted-foreground">상태 확인 중…</div>
      ) : ready ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {active
                ? "연동됨 — 1순위로 호출됩니다."
                : "ChatGPT 로그인 확인됨. 활성화하면 1순위로 호출됩니다."}
            </span>
            <Button
              size="sm"
              variant={active ? "outline" : "default"}
              onClick={toggle}
              disabled={toggling}
            >
              {toggling ? "처리 중…" : active ? "연동 해제" : "연동"}
            </Button>
          </div>
          {errorMsg && (
            <p className="text-xs text-red-500">{errorMsg}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {loggingIn
              ? "브라우저에서 ChatGPT 로그인을 완료해주세요. 끝나면 자동으로 인증됩니다…"
              : "버튼을 누르면 ChatGPT 로그인 창이 자동으로 열립니다."}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={startLogin} disabled={loggingIn}>
              <LogIn className="size-3.5 mr-1" />
              {loggingIn ? "로그인 대기 중…" : "ChatGPT로 로그인"}
            </Button>
            <a
              href="https://developers.openai.com/codex/auth"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              가이드
              <ExternalLink className="size-3" />
            </a>
          </div>
          {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}
