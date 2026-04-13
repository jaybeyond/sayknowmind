import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";

interface ServiceStatus {
  id: string;
  name: string;
  url: string;
  status: "online" | "offline" | "degraded";
  latencyMs?: number;
  version?: string;
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".railway.internal")) return `[internal] ${u.port || "default"}`;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return `[local] ${u.port || "default"}`;
    return u.origin;
  } catch {
    return "[unknown]";
  }
}

async function checkService(id: string, name: string, url: string, healthPath: string): Promise<ServiceStatus> {
  const start = Date.now();
  const displayUrl = maskUrl(url);
  try {
    const res = await fetch(`${url}${healthPath}`, { signal: AbortSignal.timeout(5_000) });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      let version: string | undefined;
      try {
        const data = await res.json();
        version = data.version ?? data.Version ?? undefined;
      } catch { /* not JSON */ }
      return { id, name, url: displayUrl, status: "online", latencyMs, version };
    }
    return { id, name, url: displayUrl, status: "degraded", latencyMs };
  } catch {
    return { id, name, url: displayUrl, status: "offline" };
  }
}

export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ code: 1002, message: "Unauthorized" }, { status: 401 });
  }

  const services = await Promise.all([
    checkService("edgequake", "EdgeQuake RAG", process.env.EDGEQUAKE_URL ?? "http://localhost:8080", "/health"),
    checkService("ai-server", "AI Server", process.env.AI_SERVER_URL ?? "http://localhost:4000", "/health"),
    checkService("ipfs", "IPFS Kubo", process.env.IPFS_KUBO_API ?? "http://localhost:5001", "/api/v0/version"),
    checkService("mcp", "MCP Server", process.env.MCP_SERVER_URL ?? "http://localhost:8082", "/health"),
  ]);

  // Optional services — only check if configured
  if (process.env.SYNCTHING_API) {
    services.push(await checkService("syncthing", "Syncthing", process.env.SYNCTHING_API, "/rest/system/status"));
  }

  return NextResponse.json({ services, timestamp: new Date().toISOString() });
}
