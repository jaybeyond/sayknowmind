"use client";

/**
 * OCP (Open Claude Proxy) status card — Claude Pro/Max subscription via
 * localhost OpenAI-compatible proxy. Same UX shape as CodexStatusCard.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkles, CheckCircle2, RefreshCw, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

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

export function OcpStatusCard() {
  const { t } = useTranslation();
  const stepLabel = (step: InstallStep): string =>
    step === "idle" ? "" : t(`settings.ocp.step.${step}`);
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
        setErrorMsg(body.error ?? t("settings.ocp.toggleFailed"));
        return;
      }
      const data = await res.json();
      setReady(Boolean(data.ready));
      setActive(Boolean(data.active));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t("settings.ocp.networkError"));
    } finally {
      setToggling(false);
    }
  }, [active, t]);

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

    // Desktop path: drive the install directly through Tauri so we don't
    // round-trip through the cloud API (which always returns "desktop-only"
    // anyway and can't see the user's localhost:3456).
    const bridge = tauriBridge();
    if (bridge?.invoke) {
      try {
        setInstallStep("installing");
        const result = await bridge.invoke<{ ok: boolean; step: string; message: string }>(
          "ocp_install",
        );
        if (result?.ok) {
          setInstallStep("done");
          setInstalling(false);
          void refresh();
        } else {
          setInstallStep("failed");
          setErrorMsg(result?.message ?? t("settings.ocp.installFailed"));
          setInstalling(false);
        }
      } catch (e) {
        setInstallStep("failed");
        // Tauri invoke rejects with a plain string when the Rust command
        // returns Result::Err(String). Without this branch the real reason
        // (Node missing, git clone failed, npm error, etc.) gets swallowed
        // and the user only sees the generic fallback.
        const msg =
          typeof e === "string"
            ? e
            : e instanceof Error
              ? e.message
              : typeof e === "object" && e !== null
                ? JSON.stringify(e)
                : t("settings.ocp.installFailed");
        setErrorMsg(msg);
        setInstalling(false);
      }
      return;
    }

    // Browser/dev path: hit the cloud API and poll its progress endpoint.
    try {
      const res = await fetch("/api/integrations/ocp/install", { method: "POST" });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? t("settings.ocp.startFailed"));
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
            setErrorMsg(d.lastError ?? t("settings.ocp.failed"));
          } else if (Date.now() - start > 5 * 60 * 1000) {
            if (installTimer.current) clearInterval(installTimer.current);
            installTimer.current = null;
            setInstalling(false);
            setErrorMsg(t("settings.ocp.timeout"));
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t("settings.ocp.networkError"));
      setInstalling(false);
      setInstallStep("idle");
    }
  }, [refresh, t]);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" />
            {t("settings.ocp.title")}
            {active && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                <CheckCircle2 className="size-3" />
                {t("settings.ocp.connected")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("settings.ocp.description")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          aria-label={t("settings.ocp.refresh")}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="mt-3 text-xs text-muted-foreground">{t("settings.ocp.checking")}</div>
      ) : ready ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {active
                ? t("settings.ocp.activeNote")
                : t("settings.ocp.readyNote")}
            </span>
            <Button
              size="sm"
              variant={active ? "outline" : "default"}
              onClick={toggle}
              disabled={toggling}
            >
              {toggling
                ? t("settings.ocp.toggling")
                : active
                  ? t("settings.ocp.disconnect")
                  : t("settings.ocp.connect")}
            </Button>
          </div>
          {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {installing
              ? stepLabel(installStep)
              : t("settings.ocp.notReady")}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={startInstall}
              disabled={installing}
              className="whitespace-nowrap"
            >
              <Download className="size-3.5 mr-1 shrink-0" />
              <span className="whitespace-nowrap">
                {installing ? stepLabel(installStep) : t("settings.ocp.installButton")}
              </span>
            </Button>
            <a
              href="https://github.com/dtzp555-max/ocp#installation"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              {t("settings.ocp.guide")}
              <ExternalLink className="size-3" />
            </a>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("settings.ocp.claudeRequired")}
          </p>
          {errorMsg && <p className="text-xs text-red-500 whitespace-pre-wrap">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}
