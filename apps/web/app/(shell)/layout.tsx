import { ShellClient } from "./shell-client";

// The dashboard shell is per-user (AuthGate picks the authenticated vs guest
// tree at runtime), so it must NOT be statically prerendered. Without this,
// Next.js can emit a long s-maxage and the CDN/edge serves stale HTML that still
// points at old JS chunks. (Preserved from the former app/page.tsx.)
export const dynamic = "force-dynamic";

/**
 * Route-group layout for the dashboard. Because an app-router layout is NOT
 * re-rendered when navigating between its child routes, the sidebar shell lives
 * here and mounts exactly once — menu clicks swap only the page content, so the
 * whole sidebar (recursive folder tree + data fetches + SSE) is no longer torn
 * down and rebuilt on every navigation.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <ShellClient>{children}</ShellClient>;
}
