"use client";

/**
 * OCP (Open Claude Proxy) status card — Claude Pro/Max subscription via
 * localhost OpenAI-compatible proxy. Same UX shape as CodexStatusCard.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkles, CheckCircle2, RefreshCw, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { PreflightChecklist, type SystemEnvCheck } from "./preflight-checklist";

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

/**
 * Ask the local OCP proxy what models it can serve, via the Tauri
 * `list_ocp_models` invoke command. Returns null outside of Tauri so
 * the caller can fall back to a hardcoded list.
 */
async function listOcpModelsLocally(): Promise<string[] | null> {
  const bridge = tauriBridge();
  if (!bridge?.invoke) return null;
  try {
    const result = await bridge.invoke<string[]>("list_ocp_models");
    if (Array.isArray(result) && result.length > 0) return result;
  } catch {
    /* fall through */
  }
  return null;
}

// Mirror the static list from main.rs's list_ocp_models fallback so the
// dropdown still works on builds where Tauri isn't reachable yet.
const OCP_MODEL_FALLBACKS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-6",
  "claude-opus-4",
  "claude-haiku-4-5",
  "claude-haiku-4",
];

type InstallStep = "idle" | "cloning" | "installing" | "configuring" | "starting" | "done" | "failed";

export function OcpStatusCard() {
  const { t } = useTranslation();
  const stepLabel = (step: InstallStep): string =>
    step === "idle" ? "" : t(`settings.ocp.step.${step}`);
  const [preflightReady, setPreflightReady] = useState<boolean>(false);
  const [preflightEnv, setPreflightEnv] = useState<SystemEnvCheck | null>(null);
  const handlePreflight = useCallback((ready: boolean, env: SystemEnvCheck | null) => {
    setPreflightReady(ready);
    setPreflightEnv(env);
  }, []);
  const [ready, setReady] = useState<boolean | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installStep, setInstallStep] = useState<InstallStep>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const installTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Model picker state. `availableModels` is fetched once from the local
  // OCP proxy (or a hardcoded fallback). `selectedModel` is what the
  // user picked in the dropdown — stored independently of `active` so
  // the user can choose a model before Connect, then we ship the choice
  // on activation.
  const [availableModels, setAvailableModels] = useState<string[]>(OCP_MODEL_FALLBACKS);
  const [selectedModel, setSelectedModel] = useState<string>(OCP_MODEL_FALLBACKS[0]);
  const [modelSaving, setModelSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [localReady, apiRes, modelsFromProxy] = await Promise.all([
        fetchOcpReady(),
        fetch("/api/integrations/ocp/status").catch(() => null),
        listOcpModelsLocally(),
      ]);
      setReady(localReady);
      if (modelsFromProxy && modelsFromProxy.length > 0) {
        setAvailableModels(modelsFromProxy);
      }
      if (apiRes?.ok) {
        const data = await apiRes.json();
        setActive(Boolean(data.active));
        if (typeof data.model === "string" && data.model.length > 0) {
          setSelectedModel(data.model);
        }
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
        // Activation. In a Tauri build we mint the key locally and ship
        // the plaintext to the API in the body; otherwise the API mints
        // it server-side using its own admin-key file. The currently
        // selected model travels with the request so the user's choice
        // is the model that gets stored.
        const localKey = await provisionOcpKeyLocally();
        const payload: Record<string, unknown> = { model: selectedModel };
        if (localKey) payload.clientKey = localKey;
        res = await fetch("/api/integrations/ocp/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
      if (typeof data.model === "string" && data.model.length > 0) {
        setSelectedModel(data.model);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t("settings.ocp.networkError"));
    } finally {
      setToggling(false);
    }
  }, [active, selectedModel, t]);

  /**
   * Live-update the model while OCP is already active. Sends a
   * `modelOnly` request so the API key isn't rotated and is_active stays
   * true — UI feels like "pick from dropdown, it persists immediately".
   */
  const handleModelChange = useCallback(
    async (next: string) => {
      setSelectedModel(next);
      if (!active) return; // not yet connected — change is local-only
      setModelSaving(true);
      setErrorMsg(null);
      try {
        const res = await fetch("/api/integrations/ocp/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: next, modelOnly: true }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMsg(body.error ?? t("settings.ocp.toggleFailed"));
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : t("settings.ocp.networkError"));
      } finally {
        setModelSaving(false);
      }
    },
    [active, t],
  );

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
          {/* Model picker — visible whenever OCP is reachable. When
              inactive the choice is held locally and shipped on Connect;
              when active, changing the dropdown patches the DB
              immediately via the modelOnly POST path. */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="text-xs text-muted-foreground" htmlFor="ocp-model-select">
              {t("settings.ocp.modelLabel") || "Model"}
            </label>
            <select
              id="ocp-model-select"
              className="text-xs rounded-md border border-border bg-background px-2 py-1 min-w-[200px]"
              value={selectedModel}
              onChange={(e) => void handleModelChange(e.target.value)}
              disabled={toggling || modelSaving}
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {/* If the stored model isn't in the fetched list (older
                  revision), still let the user see it instead of silently
                  swapping. */}
              {!availableModels.includes(selectedModel) && (
                <option value={selectedModel}>{selectedModel}</option>
              )}
            </select>
          </div>
          {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <PreflightChecklist variant="ocp" onReady={handlePreflight} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            {installing
              ? stepLabel(installStep)
              : t("settings.ocp.notReady")}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={startInstall}
              disabled={installing || (preflightEnv !== null && !preflightReady)}
              className="whitespace-nowrap"
              title={
                preflightEnv !== null && !preflightReady
                  ? t("settings.preflight.title")
                  : undefined
              }
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
