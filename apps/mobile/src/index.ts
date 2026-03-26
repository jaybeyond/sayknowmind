/**
 * SayknowMind Mobile App
 *
 * Features:
 * - Share Intent handling (iOS Share Sheet / Android Share Intent)
 * - Offline mode with local cache and auto-sync on reconnect
 * - Push notifications for Agent suggestions and ingestion completion
 * - Network state monitoring
 *
 * Requirements: 13.1–13.7, 4.3
 */
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";

const WEB_APP_URL = "http://localhost:3000";
const OFFLINE_CACHE_KEY = "sayknowmind_offline_cache";
const PENDING_SYNC_KEY = "sayknowmind_pending_sync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SharedContent {
  url?: string;
  text?: string;
  title?: string;
}

interface OfflineCacheEntry {
  type: "url" | "text";
  data: Record<string, string>;
  timestamp: number;
}

interface CachedDocument {
  id: string;
  title: string;
  summary: string;
  content: string;
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// Share Intent Handler
// ---------------------------------------------------------------------------

function parseSharedContent(launchUrl: string): SharedContent | null {
  try {
    const url = new URL(launchUrl);
    if (url.protocol !== "sayknowmind:") return null;
    if (url.hostname !== "share") return null;
    return {
      url: url.searchParams.get("url") ?? undefined,
      text: url.searchParams.get("text") ?? undefined,
      title: url.searchParams.get("title") ?? undefined,
    };
  } catch {
    return null;
  }
}

async function ingestSharedContent(content: SharedContent, authToken?: string): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  try {
    let endpoint: string;
    let body: Record<string, string>;

    if (content.url) {
      endpoint = `${WEB_APP_URL}/api/ingest/url`;
      body = { url: content.url };
    } else if (content.text) {
      endpoint = `${WEB_APP_URL}/api/ingest/text`;
      body = { content: content.text, title: content.title ?? "Shared from mobile" };
    } else {
      return false;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    // Network unavailable — queue for later sync
    addToPendingSync(content);
    return false;
  }
}

function navigateToSave(content: SharedContent): void {
  const target = content.url ?? encodeURIComponent(content.text ?? "");
  window.location.href = `${WEB_APP_URL}/?shared=${encodeURIComponent(target)}`;
}

// ---------------------------------------------------------------------------
// Offline Cache
// ---------------------------------------------------------------------------

function getOfflineCache(): CachedDocument[] {
  try {
    const raw = localStorage.getItem(OFFLINE_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToOfflineCache(docs: CachedDocument[]): void {
  try {
    // Keep only last 200 documents in cache
    const trimmed = docs.slice(0, 200);
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(trimmed));
  } catch { /* storage full — ignore */ }
}

/** Refresh offline cache from server */
async function refreshOfflineCache(): Promise<void> {
  try {
    const res = await fetch(`${WEB_APP_URL}/api/documents?limit=100`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return;

    const data = await res.json();
    const docs: CachedDocument[] = (data.documents ?? []).map((d: Record<string, unknown>) => ({
      id: String(d.id ?? ""),
      title: String(d.title ?? ""),
      summary: String(d.summary ?? ""),
      content: String(d.content ?? "").slice(0, 2000), // Limit cached content size
      cachedAt: Date.now(),
    }));
    saveToOfflineCache(docs);
  } catch { /* offline — use existing cache */ }
}

/** Search offline cache */
function searchOffline(query: string): CachedDocument[] {
  const cache = getOfflineCache();
  const q = query.toLowerCase();
  return cache.filter((doc) =>
    doc.title.toLowerCase().includes(q) ||
    doc.summary.toLowerCase().includes(q) ||
    doc.content.toLowerCase().includes(q),
  ).slice(0, 20);
}

// ---------------------------------------------------------------------------
// Pending Sync Queue
// ---------------------------------------------------------------------------

function getPendingSync(): OfflineCacheEntry[] {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addToPendingSync(content: SharedContent): void {
  const pending = getPendingSync();
  if (content.url) {
    pending.push({ type: "url", data: { url: content.url }, timestamp: Date.now() });
  } else if (content.text) {
    pending.push({
      type: "text",
      data: { content: content.text, title: content.title ?? "Shared from mobile" },
      timestamp: Date.now(),
    });
  }
  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(pending));
}

/** Sync all pending items when network is restored */
async function syncPendingItems(): Promise<number> {
  const pending = getPendingSync();
  if (pending.length === 0) return 0;

  let synced = 0;
  const remaining: OfflineCacheEntry[] = [];

  for (const entry of pending) {
    try {
      const endpoint = entry.type === "url"
        ? `${WEB_APP_URL}/api/ingest/url`
        : `${WEB_APP_URL}/api/ingest/text`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.data),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        synced++;
      } else {
        remaining.push(entry);
      }
    } catch {
      remaining.push(entry);
      break; // Network still down — stop trying
    }
  }

  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(remaining));

  if (synced > 0) {
    await LocalNotifications.schedule({
      notifications: [{
        title: "SayknowMind",
        body: `${synced} item(s) synced from offline queue`,
        id: Date.now(),
      }],
    });
  }

  return synced;
}

// ---------------------------------------------------------------------------
// Push Notifications
// ---------------------------------------------------------------------------

async function setupPushNotifications(): Promise<void> {
  try {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") return;

    await PushNotifications.register();

    PushNotifications.addListener("registration", (token) => {
      console.log("[mobile] Push token:", token.value);
      // Send token to server for future notifications
      fetch(`${WEB_APP_URL}/api/notifications/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.value, platform: getPlatform() }),
      }).catch(() => {});
    });

    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      console.log("[mobile] Push received:", notification);
    });

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const data = action.notification.data;
      if (data?.documentId) {
        window.location.href = `${WEB_APP_URL}/documents/${data.documentId}`;
      } else if (data?.url) {
        window.location.href = data.url;
      }
    });
  } catch (err) {
    console.warn("[mobile] Push notifications not available:", err);
  }
}

function getPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad")) return "ios";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Network State Monitoring
// ---------------------------------------------------------------------------

function setupNetworkMonitoring(): void {
  window.addEventListener("online", async () => {
    console.log("[mobile] Network restored — syncing pending items");
    await syncPendingItems();
    await refreshOfflineCache();
  });

  window.addEventListener("offline", () => {
    console.log("[mobile] Network lost — switching to offline mode");
  });
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

App.addListener("appUrlOpen", async (event) => {
  const shared = parseSharedContent(event.url);
  if (!shared) return;
  const success = await ingestSharedContent(shared);
  if (success) navigateToSave(shared);
});

App.getLaunchUrl().then(async (result) => {
  if (!result?.url) return;
  const shared = parseSharedContent(result.url);
  if (!shared) return;
  const success = await ingestSharedContent(shared);
  if (success) navigateToSave(shared);
});

// Initialize on load
setupPushNotifications();
setupNetworkMonitoring();
refreshOfflineCache();

// Expose offline search for the web view
(window as unknown as Record<string, unknown>).sayknowmindMobile = {
  searchOffline,
  getOfflineCache,
  syncPendingItems,
  getPendingSync,
};
