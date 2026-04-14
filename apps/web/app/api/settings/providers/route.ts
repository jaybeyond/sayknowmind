import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { getUserProvidersMasked, saveUserProviders, isMaskedKey } from "@/lib/provider-db";
import { getUserProviders } from "@/lib/provider-db";

export const dynamic = "force-dynamic";

/** GET — return saved provider config (keys masked) from DB */
export async function GET() {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const providers = await getUserProvidersMasked(userId);
    const activeProvider = providers.find((p) => p.isActive);
    return NextResponse.json({
      activeProviderId: activeProvider?.id ?? "",
      providers: providers.map((p) => ({
        id: p.id,
        apiKey: p.apiKey,
        model: p.model,
        baseUrl: p.baseUrl,
        extraFields: p.extraFields,
      })),
    });
  } catch (err) {
    console.error("[providers/GET] DB error:", err);
    return NextResponse.json({ activeProviderId: "", providers: [] });
  }
}

/** POST — save provider config to DB (AES-256-GCM encrypted) */
export async function POST(request: NextRequest) {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { activeProviderId, providers } = body as {
    activeProviderId?: string;
    providers?: Array<{
      id: string;
      apiKey: string;
      model: string;
      baseUrl: string;
      extraFields?: Record<string, unknown>;
    }>;
  };

  if (!Array.isArray(providers)) {
    return NextResponse.json({ message: "Invalid providers" }, { status: 400 });
  }

  // Only persist entries with keys (real or masked placeholder)
  const validProviders = providers
    .filter((p) => p.id && p.apiKey && p.baseUrl)
    .map((p) => ({
      ...p,
      isActive: p.id === (activeProviderId ?? ""),
    }));

  try {
    await saveUserProviders(userId, validProviders);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[providers/POST] DB save error:", errMsg, err);
    return NextResponse.json({ message: `Failed to save: ${errMsg}` }, { status: 500 });
  }

  // Forward decrypted keys to AI Server for cascade routing
  const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
  const AI_API_KEY = process.env.AI_API_KEY ?? "";
  try {
    // Get decrypted keys for AI Server sync
    const decrypted = await getUserProviders(userId);
    const keyMap: Record<string, string> = {};
    for (const p of decrypted) {
      if (p.apiKey) keyMap[p.id] = p.apiKey;
    }
    if (Object.keys(keyMap).length > 0) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (AI_API_KEY) headers["Authorization"] = `Bearer ${AI_API_KEY}`;
      await fetch(`${AI_SERVER_URL}/ai/keys`, {
        method: "PUT",
        headers,
        body: JSON.stringify(keyMap),
        signal: AbortSignal.timeout(5000),
      });
    }
  } catch {
    // AI Server sync failed — keys still saved in DB
  }

  return NextResponse.json({ ok: true, count: validProviders.length });
}
