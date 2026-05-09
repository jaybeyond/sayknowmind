"use client";

import { useEffect } from "react";
import { openExternal } from "@/lib/open-external";

/**
 * Globally intercept clicks on `<a target="_blank">` links and route them
 * through `openExternal`, so they open in the user's default browser when
 * running inside the Tauri desktop shell. On the web this is a no-op
 * (openExternal falls back to window.open with the same semantics).
 *
 * Mounted once at the root layout. Click events bubble up to document, so
 * a single listener handles every external link in the app.
 */
export function ExternalLinkInterceptor() {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      // Only handle plain left-clicks; preserve cmd/ctrl/middle-click semantics.
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target !== "_blank") return;

      const href = anchor.href;
      if (!href) return;

      // Skip non-http(s) protocols (mailto:, tel:, etc.) — let the browser handle them.
      const url = (() => {
        try {
          return new URL(href, window.location.href);
        } catch {
          return null;
        }
      })();
      if (!url) return;
      if (url.protocol !== "http:" && url.protocol !== "https:") return;

      event.preventDefault();
      void openExternal(url.toString());
    };

    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return null;
}
