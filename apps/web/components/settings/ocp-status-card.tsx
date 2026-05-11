"use client";

/**
 * OCP (Open Claude Proxy) status card — Claude Pro/Max subscription via
 * localhost OpenAI-compatible proxy. Same UX shape as CodexStatusCard.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkles, CheckCircle2, RefreshCw, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Lite-build readiness probe: in lite mode the Next.js server lives in the
 * cloud, so the /api status route can't actually see localhost:3456. Prefer
 * the Tauri `ocp_status` invoke command when available — it runs on the
 * user's machine.
 */

interface TauriInvoke {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function tauriBridge(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInvoke }).__TAURI_INTERNALS__ ?? null;
}

async function fetchOcpReady(): Promise<boolean> {
  const bridge = tauriBridge();
  if (bridge?.invoke) {
    try {
      const result = await bridge.invoke<{ ready: boolean }>("ocp_status");
      return Boolean(result?.ready);
    } catch {
      /* fall through */
    }
  }
  const res = await fetch("/api/integrations/ocp/status");
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.ready);
}

async function provisionOcpKeyLocally(): Promise<string | null> {
  const bridge = tauriBridge();
  if (!bridge?.invoke) return null;
  try {
    const result = await bridge.invoke<{ key: string }>("provision_ocp_key");
    return result?.key ?? null;
  } catch {
    return null;
  }
}

async function revokeOcpKeyLocally(): Promise<void> {
  const bridge = tauriBridge();
  if (!bridge?.invoke) return;
  try {
    await bridge.invoke("revoke_ocp_key");
  } catch {
    /* best-effort */
  }
}

type InstallStep = "idle" | "cloning" | "installing" | "configuring" | "starting" | "done" | "failed";

const STEP_LABEL: Record<InstallStep, string> = {
  idle: "",
  cloning: "OCP 다운로드 중…",
  installing: "의존성 설치 중…",
  configuring: "OCP 구성 중…",
  starting: "OCP 시작 중…",
  done: "설치 완료",
  failed: "설치 실패",
};

export function OcpStatusCard() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installStep, setInstallStep] = useState<InstallStep>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const installTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [localReady, apiRes] = await Promise.all([
        fetchOcpReady(),
        fetch("/api/integrations/ocp/status").catch(() => null),
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
      let res: Response;
      if (next) {
        // Activation. In a Tauri build we mint the key locally and ship the
        // plaintext to the API in the body; otherwise the API mints it
        // server-side using its own admin-key file.
        const localKey = await provisionOcpKeyLocally();
        res = await fetch("/api/integrations/ocp/status", {
          method: "POST",
          headers: localKey ? { "Content-Type": "application/json" } : undefined,
          body: localKey ? JSON.stringify({ clientKey: localKey }) : undefined,
        });
      } else {
        // Deactivation. Revoke locally first when we can — the API will
        // also try, but only succeeds when it has the admin-key itself.
        await revokeOcpKeyLocally();
        res = await fetch("/api/integrations/ocp/status", { method: "DELETE" });
      }
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
      if (installTimer.current) clearInterval(installTimer.current);
    };
  }, [refresh]);

  const startInstall = useCallback(async () => {
    setInstalling(true);
    setInstallStep("cloning");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/integrations/ocp/install", { method: "POST" });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? "설치 시작 실패");
        setInstalling(false);
        setInstallStep("idle");
        return;
      }
      // Poll progress every 1.5s — npm install can take 30-60s.
      if (installTimer.current) clearInterval(installTimer.current);
      const start = Date.now();
      installTimer.current = setInterval(async () => {
        try {
          const r = await fetch("/api/integrations/ocp/install");
          const d = await r.json();
          setInstallStep(d.step as InstallStep);
          if (d.step === "done") {
            if (installTimer.current) clearInterval(installTimer.current);
            installTimer.current = null;
            setInstalling(false);
            // Refresh status — OCP should now be healthy and the card flips.
            void refresh();
          } else if (d.step === "failed") {
            if (installTimer.current) clearInterval(installTimer.current);
            installTimer.current = null;
            setInstalling(false);
            setErrorMsg(d.lastError ?? "설치 실패");
          } else if (Date.now() - start > 5 * 60 * 1000) {
            if (installTimer.current) clearInterval(installTimer.current);
            installTimer.current = null;
            setInstalling(false);
            setErrorMsg("설치 대기 시간 초과");
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "네트워크 오류");
      setInstalling(false);
      setInstallStep("idle");
    }
  }, [refresh]);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" />
            Claude 구독 (OCP)
            {active && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                <CheckCircle2 className="size-3" />
                연동됨
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            본인 Claude Pro/Max 구독을 OCP 프록시로 OpenAI 호환 API화. API 키 불필요, 호출 비용 0.
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
                ? "연동됨 — Claude 구독으로 호출됩니다."
                : "OCP 실행 확인됨. 연동을 누르면 전용 키가 자동 발급됩니다."}
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
          {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {installing
              ? STEP_LABEL[installStep]
              : "버튼을 누르면 OCP를 자동으로 다운로드·설치·시작합니다."}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={startInstall} disabled={installing}>
              <Download className="size-3.5 mr-1" />
              {installing ? STEP_LABEL[installStep] : "자동 설치 + 시작"}
            </Button>
            <a
              href="https://github.com/dtzp555-max/ocp#installation"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              가이드
              <ExternalLink className="size-3" />
            </a>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Claude CLI에 먼저 로그인되어 있어야 합니다 — <code className="text-[11px]">claude auth login</code>
          </p>
          {errorMsg && <p className="text-xs text-red-500 whitespace-pre-wrap">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}
