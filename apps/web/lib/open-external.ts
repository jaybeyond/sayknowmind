/**
 * Open a URL in the user's default browser when running inside the Tauri
 * desktop shell, or in a new tab when running on the web.
 *
 * Tauri's webview blocks `window.open(..., "_blank")` for security reasons,
 * so the desktop build needs to delegate URL opening to the OS via the
 * Tauri shell plugin. This helper hides that branching from callers.
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;

  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch (err) {
      // Fall through to window.open if the plugin call fails for any reason
      // (e.g. bundle missing the plugin) — better to attempt a fallback than
      // silently swallow the click.
      console.error("[openExternal] Tauri shell.open failed, falling back:", err);
    }
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
