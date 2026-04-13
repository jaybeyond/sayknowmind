import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const APP_DATA = join(
  process.env.HOME ?? ".",
  "Library", "Application Support", "com.sayknowmind.desktop",
);

const NODE_DIR = join(APP_DATA, "node");
const NODE_BIN = join(NODE_DIR, "bin", "node");
const WEB_DIR = join(APP_DATA, "web-standalone");

// Detect architecture
function getNodeUrl(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  return `https://nodejs.org/dist/v22.15.0/node-v22.15.0-${platform}-${arch}.tar.gz`;
}

/** GET /api/desktop/runtime — Check runtime status */
export async function GET() {
  const nodeReady = existsSync(NODE_BIN);
  const serverReady = existsSync(join(WEB_DIR, "server.js"));
  let nodeVersion: string | null = null;

  if (nodeReady) {
    try {
      nodeVersion = execSync(`"${NODE_BIN}" --version`, { encoding: "utf-8" }).trim();
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    ready: nodeReady && serverReady,
    nodeInstalled: nodeReady,
    serverInstalled: serverReady,
    nodeVersion,
    appDataPath: APP_DATA,
  });
}

/** POST /api/desktop/runtime — Download and install runtime (SSE progress) */
export async function POST(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") ?? "download";

  if (action === "start") {
    return startServer();
  }
  if (action === "stop") {
    return stopServer();
  }
  if (action === "delete") {
    return deleteRuntime();
  }

  // Download with SSE progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        mkdirSync(APP_DATA, { recursive: true });

        // Step 1: Download Node.js
        if (!existsSync(NODE_BIN)) {
          send({ progress: 5, label: "Downloading Node.js..." });
          const nodeUrl = getNodeUrl();
          const tarPath = join(APP_DATA, "node.tar.gz");

          const res = await fetch(nodeUrl);
          if (!res.ok || !res.body) throw new Error("Failed to download Node.js");

          const total = Number(res.headers.get("content-length") ?? 0);
          let downloaded = 0;

          const dest = createWriteStream(tarPath);
          const reader = res.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            dest.write(Buffer.from(value));
            downloaded += value.length;
            if (total > 0) {
              const pct = Math.round((downloaded / total) * 40) + 5; // 5-45%
              send({ progress: pct, label: `Downloading Node.js (${Math.round(downloaded / 1024 / 1024)}MB)` });
            }
          }
          dest.end();
          await new Promise<void>((resolve) => dest.on("finish", resolve));

          send({ progress: 48, label: "Extracting Node.js..." });
          mkdirSync(NODE_DIR, { recursive: true });
          execSync(`tar -xzf "${tarPath}" --strip-components=1 -C "${NODE_DIR}"`, { timeout: 60000 });
          unlinkSync(tarPath);
          send({ progress: 50, label: "Node.js installed" });
        } else {
          send({ progress: 50, label: "Node.js already installed" });
        }

        // Step 2: Build/copy web-standalone
        if (!existsSync(join(WEB_DIR, "server.js"))) {
          send({ progress: 55, label: "Preparing SayknowMind server..." });

          // Check if standalone already exists from build
          const localStandalone = join(process.cwd(), ".next", "standalone");
          if (existsSync(localStandalone)) {
            send({ progress: 60, label: "Copying server files..." });
            // Find the nested path (pnpm creates deep structure)
            const serverJs = execSync(
              `find "${localStandalone}" -name "server.js" -maxdepth 8 | head -1`,
              { encoding: "utf-8" },
            ).trim();

            if (serverJs) {
              const serverDir = join(serverJs, "..");
              mkdirSync(WEB_DIR, { recursive: true });
              execSync(`cp -r "${serverDir}/"* "${WEB_DIR}/"`, { timeout: 120000 });
              execSync(`cp -r "${serverDir}/.next" "${WEB_DIR}/.next"`, { timeout: 120000 });

              // Copy static assets
              const staticDir = join(process.cwd(), ".next", "static");
              if (existsSync(staticDir)) {
                mkdirSync(join(WEB_DIR, ".next", "static"), { recursive: true });
                execSync(`cp -r "${staticDir}/"* "${WEB_DIR}/.next/static/"`, { timeout: 60000 });
              }

              // Copy desktop-init.sql
              const initSql = join(process.cwd(), "desktop-init.sql");
              if (existsSync(initSql)) {
                execSync(`cp "${initSql}" "${WEB_DIR}/"`);
              }

              // Ensure styled-jsx is available
              const styledJsx = join(WEB_DIR, "node_modules", "styled-jsx");
              if (!existsSync(styledJsx)) {
                const pnpmStyled = execSync(
                  `find "${process.cwd()}/node_modules/.pnpm" -path "*/styled-jsx/package.json" -maxdepth 5 | head -1`,
                  { encoding: "utf-8" },
                ).trim();
                if (pnpmStyled) {
                  const styledDir = join(pnpmStyled, "..");
                  execSync(`cp -r "${styledDir}" "${styledJsx}"`);
                }
              }

              send({ progress: 90, label: "Server files ready" });
            }
          } else {
            send({ progress: 60, label: "Building server (this may take a minute)..." });
            execSync("pnpm build", { cwd: process.cwd(), timeout: 300000 });
            send({ progress: 85, label: "Copying build output..." });
            // Recursive call would re-trigger copy logic
          }
        } else {
          send({ progress: 90, label: "Server already installed" });
        }

        send({ progress: 100, label: "Complete", status: "complete" });
      } catch (err) {
        send({ error: (err as Error).message, progress: 0, label: "Failed" });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function startServer() {
  if (!existsSync(NODE_BIN) || !existsSync(join(WEB_DIR, "server.js"))) {
    return NextResponse.json({ error: "Runtime not installed" }, { status: 400 });
  }

  try {
    // Start server in background
    const { execFile } = require("child_process");
    const port = 3457;
    const child = execFile(NODE_BIN, ["server.js"], {
      cwd: WEB_DIR,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PGLITE_MODE: "true",
        PORT: String(port),
        BETTER_AUTH_SECRET: getOrCreateSecret(),
        BETTER_AUTH_URL: `http://localhost:${port}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
      },
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return NextResponse.json({ success: true, port, pid: child.pid });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function stopServer() {
  try {
    execSync("lsof -ti:3457 | xargs kill -9 2>/dev/null || true");
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}

function deleteRuntime() {
  try {
    execSync(`rm -rf "${NODE_DIR}" "${WEB_DIR}"`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function getOrCreateSecret(): string {
  const { readFileSync, writeFileSync } = require("fs");
  const secretFile = join(APP_DATA, "auth-secret");
  try {
    return readFileSync(secretFile, "utf-8").trim();
  } catch {
    const secret = execSync("openssl rand -base64 32", { encoding: "utf-8" }).trim();
    mkdirSync(APP_DATA, { recursive: true });
    writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }
}
