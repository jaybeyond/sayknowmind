/**
 * POST /api/integrations/codex/login
 *
 * Spawns `codex login` on the host machine. The bundled CLI opens its own
 * local callback server (port 1455) and pops the system browser at the
 * ChatGPT OAuth page; the user signs in and the CLI writes
 * `~/.codex/auth.json` on success.
 *
 * This is safe only when the server is running on the user's own machine
 * (dev / Tauri sidecar). We block the route in cloud production to avoid
 * spawning arbitrary processes on a shared host.
 *
 * Returns immediately after kicking off the process. The card polls
 * `/api/integrations/codex/status` until `ready` flips true.
 */

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getSession } from "@/lib/admin";
import { invalidateCodexReadyCache } from "@/lib/codex";

// Server-side gate: only block automation when the deployment is explicitly
// flagged as multi-tenant cloud. `isCloud()` from lib/environment trips on
// the server (no window) and would block desktop/dev too — wrong here.
function isMultiTenantCloud(): boolean {
  return process.env.NEXT_PUBLIC_DEPLOY_MODE === "cloud";
}

// Track the most recent login spawn so concurrent clicks don't pile up.
let activeChildPid: number | null = null;

/**
 * pnpm doesn't hoist the codex shim into `node_modules/.bin`, so we
 * prepend its actual location to PATH and spawn the `codex` command. The
 * shim itself dispatches to the right platform binary via npm optional
 * deps.
 */
function codexBinPathExtension(): string {
  return join(process.cwd(), "node_modules", ".pnpm", "node_modules", ".bin");
}

export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isMultiTenantCloud()) {
    return NextResponse.json(
      { error: "Auto-login is desktop-only. Run `npx @openai/codex login` on your machine." },
      { status: 403 },
    );
  }

  if (activeChildPid !== null) {
    return NextResponse.json(
      { pid: activeChildPid, alreadyRunning: true },
      { status: 202 },
    );
  }

  // Detached + stdio:'ignore' so the child outlives this HTTP request.
  // The CLI will open the browser, run its callback server on :1455,
  // and exit after writing auth.json (success) or on timeout.
  const child = spawn("codex", ["login"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PATH: `${codexBinPathExtension()}:${process.env.PATH ?? ""}`,
    },
  });
  activeChildPid = child.pid ?? null;
  child.unref();
  child.on("exit", () => {
    activeChildPid = null;
    invalidateCodexReadyCache();
  });
  child.on("error", () => {
    activeChildPid = null;
  });

  return NextResponse.json({ pid: activeChildPid, started: true }, { status: 202 });
}
