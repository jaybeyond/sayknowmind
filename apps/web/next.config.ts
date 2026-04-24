import type { NextConfig } from "next";

const isDesktopBuild = process.env.NEXT_PUBLIC_DEPLOY_MODE === "desktop";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
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
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
            "img-src 'self' data: https://api.dicebear.com https://www.google.com https:",
            "font-src 'self' https://cdn.fontshare.com",
            `connect-src 'self' http://127.0.0.1:* http://localhost:* ${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"} ${process.env.NEXT_PUBLIC_EDGEQUAKE_URL ?? ""} ${process.env.NEXT_PUBLIC_AI_SERVER_URL ?? ""}`.trim(),
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

