import { create } from "zustand";

export type RuntimeStatus = "checking" | "not-installed" | "downloading" | "ready" | "running" | "error";

export interface EnvironmentInfo {
  node: { version: string; source: "bundled" | "system"; path: string } | null;
  docker: { version: string } | null;
  ollama: { version: string; running: boolean } | null;
  git: { version: string } | null;
  serverInstalled: boolean;
}

interface RuntimeState {
  status: RuntimeStatus;
  downloadProgress: number; // 0-100
  downloadLabel: string;
  nodeVersion: string | null;
  serverPort: number | null;
  error: string | null;
  environment: EnvironmentInfo | null;

  // Actions
  checkRuntime: () => Promise<void>;
  downloadRuntime: () => Promise<void>;
  startLocalServer: () => Promise<void>;
  stopLocalServer: () => Promise<void>;
  setStatus: (status: RuntimeStatus) => void;
  setProgress: (progress: number, label: string) => void;
}

const RUNTIME_API = "/api/desktop/runtime";
const LOCAL_API = "http://127.0.0.1:3458";

/** Read injected env from Tauri webview, or fall back to API */
function getInjectedEnv(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error — injected by Tauri main.rs via eval()
  const env = window.__SAYKNOW_ENV__;
  return env && typeof env === "object" ? env as Record<string, unknown> : null;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: "checking",
  downloadProgress: 0,
  downloadLabel: "",
  nodeVersion: null,
  serverPort: null,
  error: null,
  environment: null,

  setStatus: (status) => set({ status }),
  setProgress: (progress, label) => set({ downloadProgress: progress, downloadLabel: label }),

  checkRuntime: async () => {
    set({ status: "checking", error: null });
    try {
      // Priority 1: Local API server on port 3458 (most accurate, runs on user's machine)
      let data: Record<string, unknown> | null = null;
      try {
        const res = await fetch(`${LOCAL_API}/env`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) data = await res.json();
      } catch { /* local API not available */ }

      // Priority 2: Injected env from Tauri webview eval
      if (!data) {
        data = getInjectedEnv();
      }

      // No cloud fallback — cloud API returns server env, not user's machine
      if (!data) {
        set({ status: "not-installed", environment: null });
        return;
      }

      // Normalize: local API has flat structure, cloud API has nested .environment
      const env = (data.environment ?? {}) as Record<string, unknown>;
      const node = (data.node ?? env.node ?? null) as EnvironmentInfo["node"];
      const docker = (data.docker ?? env.docker ?? null) as EnvironmentInfo["docker"];
      const ollama = (data.ollama ?? env.ollama ?? null) as EnvironmentInfo["ollama"];
      const git = (data.git ?? env.git ?? null) as EnvironmentInfo["git"];
      const serverInstalled = (data.serverInstalled ?? false) as boolean;
      const ready = !!(node && serverInstalled);

      set({
        status: ready ? "ready" : "not-installed",
        nodeVersion: node?.version ?? null,
        serverPort: null,
        environment: { node, docker, ollama, git, serverInstalled },
      });
    } catch {
      set({ status: "not-installed", error: null });
    }
  },

  downloadRuntime: async () => {
    set({ status: "downloading", downloadProgress: 10, downloadLabel: "Downloading Node.js + server...", error: null });
    try {
      const res = await fetch(`${LOCAL_API}/download`);
      if (!res.ok) throw new Error("Download failed");
      const data = await res.json();
      if (data.error) {
        set({ status: "error", error: data.error, downloadProgress: 0 });
      } else if (data.serverNeeded) {
        set({ status: "not-installed", downloadProgress: 50, downloadLabel: data.message, error: data.message });
      } else {
        set({ status: "ready", downloadProgress: 100, downloadLabel: "Complete" });
      }
    } catch (err) {
      set({ status: "error", error: (err as Error).message, downloadProgress: 0 });
    }
  },

  startLocalServer: async () => {
    try {
      const res = await fetch(`${LOCAL_API}/start`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ status: "running", serverPort: data.port });
    } catch (err) {
      set({ status: "error", error: (err as Error).message });
    }
  },

  stopLocalServer: async () => {
    try {
      await fetch(`${LOCAL_API}/stop`);
      set({ status: "ready", serverPort: null });
    } catch {
      // silent
    }
  },
}));

// Re-check when Tauri injects env (fires after page load)
if (typeof window !== "undefined") {
  window.addEventListener("sayknow-env-ready", () => {
    useRuntimeStore.getState().checkRuntime();
  });
}
