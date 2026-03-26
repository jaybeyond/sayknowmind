import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import {
  readProviderConfig,
  writeProviderConfig,
  type ProviderConfig,
} from "@/lib/provider-config";

export const dynamic = "force-dynamic";

/** GET — return saved provider config (keys masked) */
export async function GET() {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const config = readProviderConfig();

  // Mask API keys for GET responses
  const masked: ProviderConfig = {
    activeProviderId: config.activeProviderId,
    providers: config.providers.map((p) => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 6)}...${p.apiKey.slice(-4)}` : "",
    })),
  };

  return NextResponse.json(masked);
}

/** POST — save provider config */
export async function POST(request: NextRequest) {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { activeProviderId, providers } = body as ProviderConfig;

  if (!Array.isArray(providers)) {
    return NextResponse.json({ message: "Invalid providers" }, { status: 400 });
  }

  // Only persist entries with actual keys
  const validProviders = providers.filter(
    (p) => p.id && p.apiKey && p.baseUrl,
  );

  writeProviderConfig({
    activeProviderId: activeProviderId ?? "",
    providers: validProviders,
  });

  // Forward API keys to AI Server for cascade routing
  const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
  const AI_API_KEY = process.env.AI_API_KEY ?? "";
  try {
    const keyMap: Record<string, string> = {};
    for (const p of validProviders) {
      if (p.apiKey) keyMap[p.id] = p.apiKey;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (AI_API_KEY) headers["Authorization"] = `Bearer ${AI_API_KEY}`;
    await fetch(`${AI_SERVER_URL}/ai/keys`, {
      method: "PUT",
      headers,
      body: JSON.stringify(keyMap),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // AI Server sync failed — keys still saved locally
  }

  return NextResponse.json({ ok: true, count: validProviders.length });
}
