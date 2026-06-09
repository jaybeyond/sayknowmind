import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const isDesktopBuild = process.env.NEXT_PUBLIC_DEPLOY_MODE === "desktop";

// Origin (scheme://host:port) of the realtime collab WebSocket, for CSP
// connect-src. WS uses the ws:/wss: scheme, which is NOT covered by the
// http(s) localhost sources — so it must be allowed explicitly.
const collabWsOrigin = (() => {
  const url = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
})();

// This file's directory (apps/web). Used to pin the Turbopack/file-watcher root.
const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root to apps/web. Two pnpm lockfiles exist (repo root +
  // apps/web), so Next 16 would otherwise infer the monorepo root and make the
  // dev file-watcher scan every apps/* and packages/* tree (+ their
  // node_modules and .next) → idle CPU/memory runaway. It also broke CSS module
  // resolution (tw-animate-css resolved from /apps instead of apps/web).
  turbopack: { root: appDir },
  output: "standalone",
  // jsdom + @mozilla/readability are externalized so Turbopack doesn't try to
  // bundle them at build time. jsdom transitively pulls @exodus/bytes (ESM-only)
  // through html-encoding-sniffer, which fails the page-data-collection step
  // when Next requires() it. Treating it as external defers loading to runtime.
  serverExternalPackages: ["pg", "jsdom", "@mozilla/readability"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.dicebear.com",
      },
      {
        protocol: "https",
        hostname: "www.google.com",
      },
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        // HSTS - enforce HTTPS
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
        // Content Security Policy
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            // Cloudflare-fronted deployments auto-inject the Insights beacon;
            // allow it (and the matching connect-src below) so the script tag
            // doesn't trip CSP and bury the real console errors.
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
            "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
            "img-src 'self' data: https://api.dicebear.com https://www.google.com https:",
            "font-src 'self' https://cdn.fontshare.com",
            `connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://localhost:* https://cloudflareinsights.com ${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5400"} ${process.env.NEXT_PUBLIC_EDGEQUAKE_URL ?? ""} ${process.env.NEXT_PUBLIC_AI_SERVER_URL ?? ""} ${collabWsOrigin}`.trim(),
            "frame-src 'self' https://www.instagram.com https://www.youtube.com https://www.tiktok.com https://player.vimeo.com",
            "frame-ancestors 'none'",
          ].join("; "),
        },
        // Prevent MIME sniffing
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Prevent clickjacking
        { key: "X-Frame-Options", value: "DENY" },
        // XSS protection
        { key: "X-XSS-Protection", value: "1; mode=block" },
        // Referrer policy
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Permissions policy
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
  ],
};

export default nextConfig;

