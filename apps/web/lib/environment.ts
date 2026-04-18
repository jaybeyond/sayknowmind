import { create } from "zustand";

export type DeployMode = "cloud" | "desktop" | "auto";

/** Server & client: read the build-time env var */
export function getDeployMode(): DeployMode {
  const v = process.env.NEXT_PUBLIC_DEPLOY_MODE;
  if (v === "cloud" || v === "desktop") return v;
  return "auto";
}

/** Client-only: true when running inside Tauri v2 shell */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  // Check multiple Tauri indicators (v1: __TAURI__, v2: __TAURI_INTERNALS__, __TAURI_IPC__)
  // or injected env from our Rust code (cloud URL mode)
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.__TAURI_IPC__ || w.__SAYKNOW_ENV__);
}

/** Resolved environment — works on both server and client */
export function isCloud(): boolean {
  const mode = getDeployMode();
  if (mode === "cloud") return true;
  if (mode === "desktop") return false;
  // auto: cloud when no Tauri runtime detected
  return !isDesktop();
}

/** Reactive desktop detection — updates when Tauri injects env */
export const useEnvironmentStore = create<{ desktop: boolean; cloud: boolean }>(() => ({
  desktop: isDesktop(),
  cloud: isCloud(),
}));

// Re-check when Tauri injects env (fires after page load)
if (typeof window !== "undefined") {
  window.addEventListener("sayknow-env-ready", () => {
    useEnvironmentStore.setState({ desktop: isDesktop(), cloud: isCloud() });
  });

  // Re-check after delay in case Tauri env injection was late
  setTimeout(() => {
    if (isDesktop()) {
      useEnvironmentStore.setState({ desktop: true, cloud: false });
    }
  }, 2000);
}
