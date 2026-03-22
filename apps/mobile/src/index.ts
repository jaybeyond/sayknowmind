/**
 * SayknowMind Mobile App — Share Intent Handler
 *
 * Handles content shared TO SayknowMind from other apps (iOS Share Sheet / Android Share Intent).
 * On app launch, checks for pending shared content and routes it to the web ingest API.
 *
 * Requirements: 12.4, 4.3
 */
import { App } from "@capacitor/app";

const WEB_APP_URL = "http://localhost:3000";

interface SharedContent {
  url?: string;
  text?: string;
  title?: string;
}

/**
 * Parse shared content from the app launch URL or plugin data.
 * iOS Share Extension passes data via custom URL scheme: sayknowmind://share?url=...
 * Android Share Intent passes data via the app URL.
 */
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

/**
 * Send shared content to the web app ingest API.
 */
async function ingestSharedContent(content: SharedContent): Promise<void> {
  try {
    let endpoint: string;
    let body: Record<string, string>;

    if (content.url) {
      endpoint = `${WEB_APP_URL}/api/ingest/url`;
      body = { url: content.url };
    } else if (content.text) {
      endpoint = `${WEB_APP_URL}/api/ingest/text`;
      body = {
        content: content.text,
        title: content.title ?? "Shared from mobile",
      };
    } else {
      return;
    }

    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[mobile] Failed to ingest shared content:", err);
  }
}

/**
 * Handle a share intent URL — navigate the web view to confirm the save.
 */
function navigateToSave(content: SharedContent): void {
  const target = content.url ?? encodeURIComponent(content.text ?? "");
  const confirmUrl = `${WEB_APP_URL}/?shared=${encodeURIComponent(target)}`;
  window.location.href = confirmUrl;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

App.addListener("appUrlOpen", async (event) => {
  const shared = parseSharedContent(event.url);
  if (!shared) return;

  await ingestSharedContent(shared);
  navigateToSave(shared);
});

// Handle launch URL (app opened via share while not running)
App.getLaunchUrl().then(async (result) => {
  if (!result?.url) return;
  const shared = parseSharedContent(result.url);
  if (!shared) return;

  await ingestSharedContent(shared);
  navigateToSave(shared);
});
