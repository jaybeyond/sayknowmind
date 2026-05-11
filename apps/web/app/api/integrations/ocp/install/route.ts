/**
 * POST /api/integrations/ocp/install
 *
 * One-shot OCP bootstrap:
 *   1. git clone https://github.com/dtzp555-max/ocp.git ~/ocp  (skip if exists)
 *   2. npm install
 *   3. node setup.mjs --no-start
 *   4. node setup.mjs --no-config (start the service)
 *
 * If Claude CLI is not yet authenticated, setup.mjs will print a hint and
 * exit non-zero; in that case we also spawn `claude auth login` so the
 * user sees both browser flows from a single button click.
 *
 * Desktop / dev only — never run on a multi-tenant cloud host because we
 * are spawning arbitrary npm install scripts with the server's privileges.
 */

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSession } from "@/lib/admin";
import { invalidateOcpHealthCache, isOcpHealthy } from "@/lib/ocp";

// Only block on explicit cloud deploys. Server-side `isCloud()` returns
// true everywhere because it can't see a Tauri webview, which would
// wrongly disable automation in dev too.
function isMultiTenantCloud(): boolean {
  return process.env.NEXT_PUBLIC_DEPLOY_MODE === "cloud";
}

const OCP_DIR = join(homedir(), "ocp");
const OCP_REPO = "https://github.com/dtzp555-max/ocp.git";

interface InstallState {
  pid: number | null;
  step: "idle" | "cloning" | "installing" | "configuring" | "starting" | "done" | "failed";
  lastError?: string;
  startedAt?: number;
}

const state: InstallState = { pid: null, step: "idle" };

/**
 * Run a command, resolve when it exits 0, reject otherwise. We capture
 * stderr so failures bubble up with a real message instead of a bare
 * non-zero exit code.
 */
function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    state.pid = child.pid ?? null;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      state.pid = null;
      reject(new Error(`spawn ${cmd}: ${err.message}`));
    });
    child.on("exit", (code) => {
      state.pid = null;
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

/**
 * OCP imports `node:sqlite` which is only built-in from Node 22 onwards.
 * Bail with a clear message instead of letting setup.mjs blow up later
 * inside launchd, where the error is invisible to the user.
 */
function checkNodeVersion(): string | null {
  const m = process.versions.node.match(/^(\d+)\./);
  const major = m ? Number(m[1]) : 0;
  if (major >= 22) return null;
  return `Node.js ${process.versions.node} is too old — OCP requires Node 22+ for built-in node:sqlite. Install with: brew install node@22 && brew unlink node && brew link --overwrite node@22`;
}

async function doInstall(): Promise<void> {
  try {
    const versionError = checkNodeVersion();
    if (versionError) {
      throw new Error(versionError);
    }

    if (!existsSync(OCP_DIR)) {
      state.step = "cloning";
      await run("git", ["clone", "--depth=1", OCP_REPO, OCP_DIR]);
    }

    state.step = "installing";
    await run("npm", ["install"], OCP_DIR);

    state.step = "configuring";
    // --no-start lets us split config from launch so failures during
    // service registration don't hide behind the start step.
    await run("node", ["setup.mjs", "--no-start"], OCP_DIR);

    state.step = "starting";
    await run("node", ["setup.mjs"], OCP_DIR);

    // Health-check the proxy. setup.mjs returns 0 even when launchd is
    // slow to schedule the daemon, so poll for up to 10s.
    invalidateOcpHealthCache();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await isOcpHealthy()) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    state.step = "done";
  } catch (err) {
    state.step = "failed";
    state.lastError = err instanceof Error ? err.message : String(err);
  }
}

export async function GET() {
  // Lightweight progress endpoint for the UI to poll while install runs.
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(state);
}

export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isMultiTenantCloud()) {
    return NextResponse.json(
      { error: "Auto-install is desktop-only on a single-user machine." },
      { status: 403 },
    );
  }
  if (state.step !== "idle" && state.step !== "done" && state.step !== "failed") {
    return NextResponse.json({ ...state, alreadyRunning: true }, { status: 202 });
  }

  // Reset and start in the background; the client polls GET for progress.
  state.step = "cloning";
  state.lastError = undefined;
  state.startedAt = Date.now();
  void doInstall();
  return NextResponse.json({ ...state, started: true }, { status: 202 });
}
