import { create } from "zustand";

export type DeployMode = "cloud" | "desktop" | "auto";
export type DesktopMode = "full" | "lite" | null;

/** Server & client: read the build-time env var */
export function getDeployMode(): DeployMode {
  const v = process.env.NEXT_PUBLIC_DEPLOY_MODE;
  if (v === "cloud" || v === "desktop") return v;
  return "auto";
}

/** Client-only: true when running inside Tauri desktop shell */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;

  // Build-time: DEPLOY_MODE=desktop means we're bundled in Tauri
  if (getDeployMode() === "desktop") return true;

  // Runtime: check Tauri globals (available when loaded from localhost in Tauri webview)
  const w = window as unknown as Record<string, unknown>;
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.__TAURI_IPC__ || w.__TAURI_DESKTOP__ || w.__SAYKNOW_ENV__);
}

/** Client-only: returns "full" | "lite" when injected by Tauri, else null */
export function getDesktopMode(): DesktopMode {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __SAYKNOW_ENV__?: { mode?: string } };
  const mode = w.__SAYKNOW_ENV__?.mode;
  if (mode === "desktop-full") return "full";
  if (mode === "desktop-lite") return "lite";
  return null;
}

/** Resolved environment — works on both server and client */
export function isCloud(): boolean {
  const mode = getDeployMode();
  if (mode === "cloud") return true;
  if (mode === "desktop") return false;
  return !isDesktop();
}

/** Reactive desktop detection */
export const useEnvironmentStore = create<{
  desktop: boolean;
  cloud: boolean;
  desktopMode: DesktopMode;
}>(() => ({
  desktop: isDesktop(),
  cloud: isCloud(),
  desktopMode: getDesktopMode(),
}));

// Single re-check after Tauri env injection (only needed for auto mode)
if (typeof window !== "undefined" && getDeployMode() === "auto") {
  window.addEventListener("sayknow-env-ready", () => {
    useEnvironmentStore.setState({
      desktop: isDesktop(),
      cloud: isCloud(),
      desktopMode: getDesktopMode(),
    });
  });
}
