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
      // Try injected env from Tauri (runs on user's machine)
      const tauriData = getInjectedEnv();

      if (tauriData) {
        const node = tauriData.node as { version: string; source: string; path: string } | null;
        set({
          status: (node && tauriData.serverInstalled) ? "ready" : "not-installed",
          nodeVersion: node?.version ?? null,
          serverPort: null,
          environment: {
            node: node as EnvironmentInfo["node"],
            docker: tauriData.docker as EnvironmentInfo["docker"],
            ollama: tauriData.ollama as EnvironmentInfo["ollama"],
            git: tauriData.git as EnvironmentInfo["git"],
            serverInstalled: tauriData.serverInstalled as boolean,
          },
        });
        return;
      }

      // Fallback: API call (cloud mode)
      const res = await fetch(`${RUNTIME_API}`);
      if (!res.ok) throw new Error("Check failed");
      const data = await res.json();
      set({
        status: data.ready ? "ready" : "not-installed",
        nodeVersion: data.node?.version ?? null,
        serverPort: data.serverPort ?? null,
        environment: {
          node: data.node,
          docker: data.environment?.docker ?? null,
          ollama: data.environment?.ollama ?? null,
          git: data.environment?.git ?? null,
          serverInstalled: data.serverInstalled,
        },
      });
    } catch {
      set({ status: "not-installed", error: null });
    }
  },

  downloadRuntime: async () => {
    set({ status: "downloading", downloadProgress: 0, downloadLabel: "Preparing...", error: null });
    try {
      const res = await fetch(`${RUNTIME_API}/download`, { method: "POST" });
      if (!res.ok) throw new Error("Download failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.progress !== undefined) {
              set({ downloadProgress: event.progress, downloadLabel: event.label ?? "" });
            }
            if (event.status === "complete") {
              set({ status: "ready", downloadProgress: 100, downloadLabel: "Complete" });
            }
            if (event.error) {
              set({ status: "error", error: event.error });
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      set({ status: "error", error: (err as Error).message });
    }
  },

  startLocalServer: async () => {
    try {
      const res = await fetch(`${RUNTIME_API}/start`, { method: "POST" });
      if (!res.ok) throw new Error("Start failed");
      const data = await res.json();
      set({ status: "running", serverPort: data.port });
    } catch (err) {
      set({ status: "error", error: (err as Error).message });
    }
  },

  stopLocalServer: async () => {
    try {
      await fetch(`${RUNTIME_API}/stop`, { method: "POST" });
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
