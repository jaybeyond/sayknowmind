"use client";

/**
 * Preflight checklist with inline fix actions.
 *
 * For every blocking row that fails we surface a one-click action that
 * either spawns the right Tauri command (`claude auth login`,
 * `npm install -g @anthropic-ai/claude-code`) or kicks the system browser
 * at the right download page (Node, git, Claude CLI install docs).
 *
 * Renders nothing on plain cloud browsers — only meaningful inside Tauri.
 */

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, XCircle, RefreshCw, ExternalLink } from "lucide-react";
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

/** Action attached to a non-OK row. */
type FixAction =
  | { kind: "openUrl"; url: string; label: string }
  | { kind: "claudeInstall"; label: string }
  | { kind: "claudeAuth"; label: string };

interface CheckRow {
  level: CheckLevel;
  text: string;
  fix?: FixAction;
}

function StatusIcon({ level }: { level: CheckLevel }) {
  if (level === "ok") return <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />;
  if (level === "warn") return <AlertCircle className="size-3.5 text-amber-400 shrink-0 mt-0.5" />;
  return <XCircle className="size-3.5 text-red-400 shrink-0 mt-0.5" />;
}

function deriveOcpRows(env: SystemEnvCheck, t: (key: string) => string): CheckRow[] {
  const rows: CheckRow[] = [];

  // Node
  if (!env.node_version) {
    rows.push({
      level: "fail",
      text: t("settings.preflight.nodeMissing"),
      fix: { kind: "openUrl", url: "https://nodejs.org/en/download", label: t("settings.preflight.fixDownload") },
    });
  } else if (!env.node_meets_required) {
    rows.push({
      level: "fail",
      text: t("settings.preflight.nodeTooOld").replace("{version}", env.node_version),
      fix: { kind: "openUrl", url: "https://nodejs.org/en/download", label: t("settings.preflight.fixDownload") },
    });
  } else {
    rows.push({
      level: "ok",
      text: t("settings.preflight.nodeOk").replace("{version}", env.node_version),
    });
  }

  // git
  if (!env.git_version) {
    rows.push({
      level: "fail",
      text: t("settings.preflight.gitMissing"),
      fix: { kind: "openUrl", url: "https://git-scm.com/download/mac", label: t("settings.preflight.fixDownload") },
    });
  } else {
    rows.push({
      level: "ok",
      text: t("settings.preflight.gitOk").replace("{version}", env.git_version),
    });
  }

  // claude CLI
  if (!env.claude_version) {
    rows.push({
      level: "warn",
      text: t("settings.preflight.claudeMissing"),
      fix: { kind: "claudeInstall", label: t("settings.preflight.fixInstall") },
    });
  } else if (!env.claude_authenticated) {
    rows.push({
      level: "warn",
      text: t("settings.preflight.claudeNotAuthed"),
      fix: { kind: "claudeAuth", label: t("settings.preflight.fixAuthLogin") },
    });
  } else {
    rows.push({
      level: "ok",
      text: t("settings.preflight.claudeOk").replace("{version}", env.claude_version),
    });
  }

  // OCP local state — informational, no fix actions (the install button handles it)
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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const bridge = tauriBridge();
    if (!bridge?.invoke) {
      setLoading(false);
      onReady?.(false, null);
      return;
    }
    setLoading(true);
    setActionError(null);
    try {
      const result = await bridge.invoke<SystemEnvCheck>("system_env_check");
      setEnv(result);
      const ready =
        variant === "codex"
          ? true /* codex sidecar is bundled */
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

  const runFix = useCallback(
    async (action: FixAction, key: string) => {
      setActionError(null);
      setBusyAction(key);
      const bridge = tauriBridge();
      try {
        if (action.kind === "openUrl") {
          // Tauri's main window navigation handler turns external URLs into
          // system-browser opens, so a plain anchor click works. But here we
          // emit window.open so the click handler always wins regardless of
          // ancestor anchor wrappers.
          window.open(action.url, "_blank", "noopener");
        } else if (action.kind === "claudeAuth") {
          if (!bridge?.invoke) throw new Error("no tauri bridge");
          await bridge.invoke("claude_auth_login");
        } else if (action.kind === "claudeInstall") {
          if (!bridge?.invoke) throw new Error("no tauri bridge");
          await bridge.invoke("install_claude_cli");
          // Re-probe after the install attempt.
          await refresh();
        }
      } catch (e) {
        const msg = typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.preflight.fixError");
        setActionError(msg);
      } finally {
        setBusyAction(null);
      }
    },
    [refresh, t],
  );

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

      {loading || !env ? (
        <p className="text-xs text-muted-foreground">{t("settings.preflight.checking")}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {rows.map((row, i) => {
              const key = `row-${i}`;
              const busy = busyAction === key;
              return (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                  <StatusIcon level={row.level} />
                  <div className="flex-1 min-w-0 flex items-start justify-between gap-2 flex-wrap">
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
                    {row.fix && (
                      <button
                        type="button"
                        onClick={() => runFix(row.fix!, key)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {busy
                          ? t("settings.preflight.fixInstalling")
                          : row.fix.label}
                        {row.fix.kind === "openUrl" && <ExternalLink className="size-3" />}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {actionError && (
            <p className="text-[11px] text-red-400">{actionError}</p>
          )}
          {allOk && (
            <p className="text-[11px] text-emerald-400">
              {t("settings.preflight.allReady")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
