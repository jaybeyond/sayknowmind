/**
 * Gmail connector.
 *
 * OAuth scopes (read-only):
 *   - gmail.readonly         : list and read messages, including attachments
 *   - userinfo.email         : identify the connected account
 *
 * Reuses the same Google Cloud OAuth app as google-drive (same
 * GOOGLE_OAUTH_CLIENT_ID), but persists tokens under a separate provider
 * key so the user can connect / disconnect Gmail independently of Drive.
 *
 * `list` returns messages from a thread or label as if they were files,
 * so the generic browser UI works without changes. The browser shows
 * threads at the root, then individual messages when a thread is opened.
 *
 * `download` returns the message body (text/plain when available, otherwise
 * extracted from text/html) plus first inline attachment if present.
 */

import {
  type Connector,
  type ConnectorMeta,
  type ConnectorListPage,
  type ConnectorItem,
  type ConnectorDownload,
  type ConnectedAccount,
} from "./_interface";
import {
  getToken,
  upsertToken,
  deleteToken,
  refreshStoredToken,
  type StoredToken,
} from "./_token-store";
import { signState, verifyState } from "./_oauth-state";

// ── Constants ──────────────────────────────────────────────────────────────

const PROVIDER = "gmail" as const;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

// ── Env helpers ────────────────────────────────────────────────────────────

function clientId(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_ID env var is not set");
  return v;
}
function clientSecret(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET env var is not set");
  return v;
}
function redirectUri(): string {
  // Gmail uses its own callback path so the OAuth consent stays scoped to this provider.
  const explicit = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL must be set so Gmail callback URI can be derived");
  return `${base.replace(/\/$/, "")}/api/integrations/connectors/gmail/oauth/callback`;
}

// ── Token refresh ──────────────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

async function refreshAccessToken(stored: StoredToken): Promise<StoredToken> {
  if (!stored.refreshToken) {
    throw new Error("Gmail token expired and no refresh_token available — user must reconnect");
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: stored.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as GoogleTokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await refreshStoredToken({
    userId: stored.userId,
    provider: PROVIDER,
    accountId: stored.accountId,
    newAccessToken: data.access_token,
    newRefreshToken: data.refresh_token,
    expiresAt,
  });
  return {
    ...stored,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? stored.refreshToken,
    expiresAt,
  };
}

async function getActiveToken(args: { userId: string; accountId: string }): Promise<StoredToken> {
  const stored = await getToken({ userId: args.userId, provider: PROVIDER, accountId: args.accountId });
  if (!stored) throw new Error("No connected Gmail account found for this user");
  if (!stored.expiresAt || stored.expiresAt.getTime() - Date.now() > 60_000) return stored;
  return refreshAccessToken(stored);
}

// ── Gmail API helpers ──────────────────────────────────────────────────────

interface GmailMessageRef {
  id: string;
  threadId: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string | undefined {
  if (!headers) return;
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** Walk MIME tree and pull the best plain-text or HTML body. */
function extractBody(part: GmailPart | undefined): { text: string; html?: string } {
  if (!part) return { text: "" };
  let text = "";
  let html: string | undefined;

  function walk(p: GmailPart) {
    const mt = (p.mimeType ?? "").toLowerCase();
    const data = p.body?.data;
    if (data && mt === "text/plain") {
      text += Buffer.from(data, "base64url").toString("utf8") + "\n";
    } else if (data && mt === "text/html") {
      html = (html ?? "") + Buffer.from(data, "base64url").toString("utf8") + "\n";
    }
    p.parts?.forEach(walk);
  }
  walk(part);

  // If we only have HTML, strip tags as a poor man's plaintext fallback so
  // the ingestion parser still has *something* to work with.
  if (!text && html) {
    text = html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { text, html };
}

// ── Connector implementation ──────────────────────────────────────────────

export const gmailConnector: Connector = {
  meta: {
    id: PROVIDER,
    displayName: "Gmail",
    description: "Read and import messages from your Gmail inbox (read-only).",
    scopes: SCOPES,
    supportsBrowse: true,
    supportsExport: false,
  } satisfies ConnectorMeta,

  buildAuthUrl({ state }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  },

  async handleOAuthCallback({ userId, code }): Promise<ConnectedAccount> {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Gmail token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
    }
    const tok = (await tokenRes.json()) as GoogleTokenResponse;

    const userRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!userRes.ok) {
      throw new Error(`Gmail userinfo failed (${userRes.status}): ${await userRes.text()}`);
    }
    const profile = (await userRes.json()) as { sub: string; email?: string; name?: string };

    const expiresAt = new Date(Date.now() + tok.expires_in * 1000);
    await upsertToken({
      userId,
      provider: PROVIDER,
      accountId: profile.sub,
      accountEmail: profile.email,
      accountLabel: profile.name,
      scope: tok.scope,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt,
      metadata: {},
    });

    return {
      accountId: profile.sub,
      email: profile.email,
      label: profile.name,
      scope: tok.scope,
      connectedAt: new Date().toISOString(),
    };
  },

  async disconnect({ userId, accountId }) {
    const stored = await getToken({ userId, provider: PROVIDER, accountId });
    if (stored) {
      const tokenToRevoke = stored.refreshToken ?? stored.accessToken;
      try {
        await fetch(REVOKE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(tokenToRevoke)}`,
        });
      } catch {
        // ignore; user still wants the local row gone
      }
    }
    await deleteToken({ userId, provider: PROVIDER, accountId });
  },

  /**
   * `parentId` is interpreted as a Gmail label (e.g. "INBOX", "STARRED",
   * "IMPORTANT", "Label_123"). When undefined we list INBOX. The result is
   * one item per message — kept flat so the existing browser UI works.
   *
   * `filters` recognises:
   *   - q: a Gmail search query (overrides labelId)
   */
  async list({ userId, accountId, parentId, cursor, pageSize, filters }): Promise<ConnectorListPage> {
    const tok = await getActiveToken({ userId, accountId });
    const labelId = parentId ?? "INBOX";

    const params = new URLSearchParams({
      maxResults: String(Math.min(pageSize ?? 25, 100)),
    });
    const q = filters?.q;
    if (typeof q === "string" && q.length > 0) {
      params.set("q", q);
    } else {
      params.append("labelIds", labelId);
    }
    if (cursor) params.set("pageToken", cursor);

    const listRes = await fetch(`${GMAIL_API}/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    });
    if (!listRes.ok) {
      throw new Error(`Gmail list failed (${listRes.status}): ${await listRes.text()}`);
    }
    const listData = (await listRes.json()) as {
      messages?: GmailMessageRef[];
      nextPageToken?: string;
      resultSizeEstimate?: number;
    };

    const refs = listData.messages ?? [];
    if (refs.length === 0) {
      return { items: [], nextCursor: listData.nextPageToken };
    }

    // Fetch metadata for each ref (Subject, From, Date, snippet) — one round
    // trip per message. Gmail has no batch endpoint for free; cap pageSize.
    const items: ConnectorItem[] = await Promise.all(
      refs.map(async (ref) => {
        const metaRes = await fetch(
          `${GMAIL_API}/messages/${ref.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${tok.accessToken}` } },
        );
        if (!metaRes.ok) {
          // Fall back to bare ID if metadata fetch fails
          return {
            externalId: ref.id,
            name: `(message ${ref.id})`,
            kind: "file" as const,
            mimeType: "message/rfc822",
            externalUrl: `https://mail.google.com/mail/u/0/#inbox/${ref.id}`,
            downloadable: true,
          };
        }
        const meta = (await metaRes.json()) as GmailMessage;
        const subject = getHeader(meta.payload?.headers, "Subject") ?? "(no subject)";
        const from = getHeader(meta.payload?.headers, "From");
        const dateStr = getHeader(meta.payload?.headers, "Date");
        const internalMs = meta.internalDate ? Number(meta.internalDate) : NaN;

        return {
          externalId: ref.id,
          name: subject,
          kind: "file",
          mimeType: "message/rfc822",
          modifiedAt: !Number.isNaN(internalMs)
            ? new Date(internalMs).toISOString()
            : dateStr,
          externalUrl: `https://mail.google.com/mail/u/0/#inbox/${ref.id}`,
          downloadable: true,
          extra: { from, snippet: meta.snippet, threadId: meta.threadId },
        };
      }),
    );

    return { items, nextCursor: listData.nextPageToken };
  },

  async download({ userId, accountId, externalId }): Promise<ConnectorDownload> {
    const tok = await getActiveToken({ userId, accountId });
    const res = await fetch(`${GMAIL_API}/messages/${externalId}?format=full`, {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail message fetch failed (${res.status}): ${await res.text()}`);
    }
    const msg = (await res.json()) as GmailMessage;
    const subject = getHeader(msg.payload?.headers, "Subject") ?? "(no subject)";
    const from = getHeader(msg.payload?.headers, "From") ?? "";
    const to = getHeader(msg.payload?.headers, "To") ?? "";
    const dateStr = getHeader(msg.payload?.headers, "Date") ?? "";
    const { text } = extractBody(msg.payload);

    const composed =
      `Subject: ${subject}\n` +
      `From: ${from}\n` +
      `To: ${to}\n` +
      `Date: ${dateStr}\n\n` +
      text;

    const safeName = subject.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || externalId;

    return {
      kind: "text",
      text: composed,
      mimeType: "text/plain",
      filename: `${safeName}.eml.txt`,
    };
  },
};

export { signState, verifyState };
export const PROVIDER_ID = PROVIDER;
