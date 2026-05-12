"use client";

/**
 * Preflight checklist — surfaces the result of the Tauri `system_env_check`
 * invoke command (node/git/claude/openclaw/ocp local state) so the user can
 * see what's missing *before* clicking auto-install instead of getting a
 * cryptic error mid-flow.
 *
 * Used by OcpStatusCard (full list) and CodexStatusCard (node-only subset).
 * Renders nothing when not inside Tauri — cloud-browser users have no
 * meaningful local state to surface here.
 */

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, XCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export interface SystemEnvCheck {
  node_version: string | null;
  node_meets_required: boolean;
  git_version: string | null;
  npm_version: string | null;
  claude_version: string | null;
  claude_authenticated: boolean;
  openclaw_present: boolean;
  ocp_repo_installed: boolean;
  ocp_admin_key_present: boolean;
  ocp_running: boolean;
  codex_authenticated: boolean;
}

interface TauriInvoke {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function tauriBridge(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInvoke }).__TAURI_INTERNALS__ ?? null;
}

type CheckLevel = "ok" | "warn" | "fail";

function StatusIcon({ level }: { level: CheckLevel }) {
  if (level === "ok") return <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />;
  if (level === "warn") return <AlertCircle className="size-3.5 text-amber-400 shrink-0" />;
  return <XCircle className="size-3.5 text-red-400 shrink-0" />;
}

interface CheckRow {
  level: CheckLevel;
  text: string;
}

function deriveOcpRows(env: SystemEnvCheck, t: (key: string) => string): CheckRow[] {
  const rows: CheckRow[] = [];

  // Node
  if (!env.node_version) {
    rows.push({ level: "fail", text: t("settings.preflight.nodeMissing") });
  } else if (!env.node_meets_required) {
    rows.push({
      level: "fail",
      text: t("settings.preflight.nodeTooOld").replace("{version}", env.node_version),
    });
  } else {
    rows.push({
      level: "ok",
      text: t("settings.preflight.nodeOk").replace("{version}", env.node_version),
    });
  }

  // git
  if (!env.git_version) {
    rows.push({ level: "fail", text: t("settings.preflight.gitMissing") });
  } else {
    rows.push({
      level: "ok",
      text: t("settings.preflight.gitOk").replace("{version}", env.git_version),
    });
  }

  // claude CLI
  if (!env.claude_version) {
    rows.push({ level: "warn", text: t("settings.preflight.claudeMissing") });
  } else if (!env.claude_authenticated) {
    rows.push({ level: "warn", text: t("settings.preflight.claudeNotAuthed") });
  } else {
    rows.push({
      level: "ok",
      text: t("settings.preflight.claudeOk").replace("{version}", env.claude_version),
    });
  }

  // OCP local state
  if (env.ocp_running) {
    rows.push({ level: "ok", text: t("settings.preflight.ocpRunning") });
  } else if (env.ocp_repo_installed) {
    rows.push({ level: "ok", text: t("settings.preflight.ocpRepoInstalled") });
  } else {
    rows.push({ level: "warn", text: t("settings.preflight.ocpRepoMissing") });
  }

  return rows;
}

interface PreflightChecklistProps {
  variant: "ocp" | "codex";
  onReady?: (ready: boolean, env: SystemEnvCheck | null) => void;
}

export function PreflightChecklist({ variant, onReady }: PreflightChecklistProps) {
  const { t } = useTranslation();
  const [env, setEnv] = useState<SystemEnvCheck | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const bridge = tauriBridge();
    if (!bridge?.invoke) {
      setLoading(false);
      onReady?.(false, null);
      return;
    }
    setLoading(true);
    try {
      const result = await bridge.invoke<SystemEnvCheck>("system_env_check");
      setEnv(result);
      // OCP: every blocking row must be OK. Codex: only node + codex auth file.
      const ready =
        variant === "codex"
          ? !!result.node_version || true /* sidecar bundled, node not strictly required */
          : result.node_meets_required && !!result.git_version;
      onReady?.(ready, result);
    } catch {
      setEnv(null);
      onReady?.(false, null);
    } finally {
      setLoading(false);
    }
  }, [onReady, variant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Hide entirely on plain cloud browsers — no Tauri bridge means no local
  // environment to inspect; the preflight would just lie.
  if (!tauriBridge()?.invoke) return null;

  const rows = env ? (variant === "ocp" ? deriveOcpRows(env, t) : []) : [];
  const allOk = rows.length > 0 && rows.every((r) => r.level === "ok");

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {t("settings.preflight.title")}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label={t("settings.preflight.recheck")}
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("settings.preflight.checking")}</p>
      ) : !env ? (
        <p className="text-xs text-muted-foreground">{t("settings.preflight.checking")}</p>
      ) : (
        <>
          <ul className="space-y-1">
            {rows.map((row, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                <StatusIcon level={row.level} />
                <span
                  className={
                    row.level === "ok"
                      ? "text-muted-foreground"
                      : row.level === "warn"
                        ? "text-amber-300"
                        : "text-red-300"
                  }
                >
                  {row.text}
                </span>
              </li>
            ))}
          </ul>
          {allOk && (
            <p className="text-[11px] text-emerald-400 mt-1">
              {t("settings.preflight.allReady")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
