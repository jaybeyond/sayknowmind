/**
 * Google Drive connector.
 *
 * Multi-account, per-user. Every method takes (userId, accountId) and
 * looks up that user's tokens — never a shared/global account.
 *
 * OAuth scopes (read-only):
 *   - drive.readonly         : list and download files
 *   - drive.metadata.readonly: file metadata for browse UI
 *   - userinfo.email         : identify the connected account
 *   - userinfo.profile       : display name (optional)
 *
 * Tokens are stored encrypted in user_integration_tokens. Access tokens
 * expire (~1 hour); we refresh transparently before each API call when
 * `expires_at` is past.
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

const PROVIDER = "google-drive" as const;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

/** MIME types for Google native docs that need export to a downloadable form. */
const EXPORT_MIME: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document":     { mime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.spreadsheet":  { mime: "text/csv",   ext: "csv" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "txt" },
  // Google Drawings → PNG; we still send to ingestion
  "application/vnd.google-apps.drawing":      { mime: "image/png",  ext: "png" },
};

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
  const v = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (v) return v;
  // Fall back to the canonical app URL + the route this connector mounts at.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!base) throw new Error("GOOGLE_OAUTH_REDIRECT_URI or NEXT_PUBLIC_APP_URL must be set");
  return `${base.replace(/\/$/, "")}/api/integrations/connectors/google-drive/oauth/callback`;
}

// ── Token refresh ──────────────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
}

async function refreshAccessToken(stored: StoredToken): Promise<StoredToken> {
  if (!stored.refreshToken) {
    throw new Error("Token expired and no refresh_token available — user must reconnect");
  }
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: stored.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${err}`);
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

/** Fetch a fresh token for this (user, account), refreshing if needed. */
async function getActiveToken(args: { userId: string; accountId: string }): Promise<StoredToken> {
  const stored = await getToken({ userId: args.userId, provider: PROVIDER, accountId: args.accountId });
  if (!stored) {
    throw new Error("No connected Google Drive account found for this user");
  }
  if (!stored.expiresAt || stored.expiresAt.getTime() - Date.now() > 60_000) {
    return stored;
  }
  return refreshAccessToken(stored);
}

// ── Drive API helpers ──────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  owners?: { emailAddress?: string; displayName?: string }[];
  iconLink?: string;
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

function parseGoogleApiError(body: string): {
  message?: string;
  reason?: string;
  service?: string;
  activationUrl?: string;
} {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{
          reason?: string;
          metadata?: {
            service?: string;
            activationUrl?: string;
          };
        }>;
      };
    };
    const err = parsed.error;
    const detailWithService = err?.details?.find((d) => d.metadata?.service || d.metadata?.activationUrl);
    return {
      message: err?.message,
      reason: detailWithService?.reason ?? err?.errors?.[0]?.reason,
      service: detailWithService?.metadata?.service,
      activationUrl: detailWithService?.metadata?.activationUrl,
    };
  } catch {
    return {};
  }
}

async function throwDriveApiError(operation: string, res: Response): Promise<never> {
  const body = await res.text();
  const parsed = parseGoogleApiError(body);

  if (
    res.status === 403 &&
    (parsed.reason === "SERVICE_DISABLED" || parsed.reason === "accessNotConfigured") &&
    parsed.service === "drive.googleapis.com"
  ) {
    throw new Error(
      "Google Drive API is disabled for this OAuth project. " +
      "Enable drive.googleapis.com in Google Cloud Console, wait a few minutes, then retry. " +
      (parsed.activationUrl ? `Enable URL: ${parsed.activationUrl}` : ""),
    );
  }

  if (res.status === 403 && parsed.reason === "insufficientPermissions") {
    throw new Error(
      "Google Drive permission was not granted for this account. Disconnect and reconnect Google Drive, then approve Drive read access.",
    );
  }

  throw new Error(
    `Drive ${operation} failed (${res.status}): ${parsed.message ?? body.slice(0, 500)}`,
  );
}

function isFolder(f: DriveFile): boolean {
  return f.mimeType === "application/vnd.google-apps.folder";
}

function toItem(f: DriveFile): ConnectorItem {
  const isNativeGoogleDoc = f.mimeType.startsWith("application/vnd.google-apps.")
    && f.mimeType !== "application/vnd.google-apps.folder";
  return {
    externalId: f.id,
    name: f.name,
    kind: isFolder(f) ? "folder" : "file",
    mimeType: f.mimeType,
    size: f.size ? Number(f.size) : undefined,
    modifiedAt: f.modifiedTime,
    externalUrl: f.webViewLink,
    downloadable: !isFolder(f) && (!isNativeGoogleDoc || f.mimeType in EXPORT_MIME),
    extra: {
      iconLink: f.iconLink,
      ownerEmail: f.owners?.[0]?.emailAddress,
    },
  };
}

// ── Connector implementation ──────────────────────────────────────────────

export const googleDriveConnector: Connector = {
  meta: {
    id: PROVIDER,
    displayName: "Google Drive",
    description: "Browse and import files from your Google Drive (read-only).",
    scopes: SCOPES,
    supportsBrowse: true,
    supportsExport: true,
  } satisfies ConnectorMeta,

  buildAuthUrl({ userId, state }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",     // request refresh token
      include_granted_scopes: "true",
      prompt: "consent",          // force refresh_token issuance every time
      state,
    });
    void userId; // userId is encoded inside `state` (signed); not in URL
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  },

  async handleOAuthCallback({ userId, code }): Promise<ConnectedAccount> {
    // 1. Exchange code for tokens
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
      const err = await tokenRes.text();
      throw new Error(`Google token exchange failed (${tokenRes.status}): ${err}`);
    }
    const tok = (await tokenRes.json()) as GoogleTokenResponse;

    // 2. Identify the connected Google account
    const userRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!userRes.ok) {
      const err = await userRes.text();
      throw new Error(`Google userinfo failed (${userRes.status}): ${err}`);
    }
    const profile = (await userRes.json()) as {
      sub: string;        // stable Google user ID
      email?: string;
      name?: string;
    };

    // 3. Persist
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
      // Best-effort revoke at Google's end. Failure here doesn't block the
      // local delete — user still wants their token gone from our DB.
      const tokenToRevoke = stored.refreshToken ?? stored.accessToken;
      try {
        await fetch(REVOKE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(tokenToRevoke)}`,
        });
      } catch {
        // ignore
      }
    }
    await deleteToken({ userId, provider: PROVIDER, accountId });
  },

  async list({ userId, accountId, parentId, cursor, pageSize, filters }): Promise<ConnectorListPage> {
    const tok = await getActiveToken({ userId, accountId });

    // Build the Drive q expression. Folders are always shown (so the user
    // can navigate) regardless of mime filter, unless the filter explicitly
    // excludes folders.
    const parts: string[] = ["trashed = false"];
    parts.push(parentId ? `'${parentId}' in parents` : `'root' in parents`);

    const mimeTypesRaw = filters?.mimeTypes;
    const mimeTypes: string[] | undefined = Array.isArray(mimeTypesRaw)
      ? mimeTypesRaw
      : typeof mimeTypesRaw === "string" && mimeTypesRaw.length > 0
        ? mimeTypesRaw.split(",")
        : undefined;
    if (mimeTypes && mimeTypes.length > 0) {
      const orClauses = mimeTypes.map((m) => `mimeType = '${m.replace(/'/g, "\\'")}'`);
      // Always include folders so navigation still works.
      orClauses.push(`mimeType = 'application/vnd.google-apps.folder'`);
      parts.push(`(${orClauses.join(" or ")})`);
    }

    const params = new URLSearchParams({
      q: parts.join(" and "),
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents, owners(emailAddress, displayName), iconLink)",
      pageSize: String(Math.min(pageSize ?? 50, 1000)),
      orderBy: "folder, name",
    });
    if (cursor) params.set("pageToken", cursor);

    const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    });
    if (!res.ok) {
      await throwDriveApiError("list", res);
    }
    const data = (await res.json()) as DriveListResponse;
    return {
      items: (data.files ?? []).map(toItem),
      nextCursor: data.nextPageToken,
    };
  },

  async download({ userId, accountId, externalId }): Promise<ConnectorDownload> {
    const tok = await getActiveToken({ userId, accountId });

    // First, fetch metadata so we know if this is a native Google doc
    // (must be exported) or a regular file (alt=media).
    const metaRes = await fetch(`${DRIVE_API}/files/${encodeURIComponent(externalId)}?fields=id,name,mimeType,size`, {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    });
    if (!metaRes.ok) {
      await throwDriveApiError("metadata", metaRes);
    }
    const meta = (await metaRes.json()) as DriveFile;

    const exportInfo = EXPORT_MIME[meta.mimeType];
    if (exportInfo) {
      // Native Google doc → export endpoint
      const exportRes = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(externalId)}/export?mimeType=${encodeURIComponent(exportInfo.mime)}`,
        { headers: { Authorization: `Bearer ${tok.accessToken}` } },
      );
      if (!exportRes.ok) {
        await throwDriveApiError("export", exportRes);
      }
      const filename = meta.name.endsWith(`.${exportInfo.ext}`) ? meta.name : `${meta.name}.${exportInfo.ext}`;

      if (exportInfo.mime.startsWith("text/")) {
        const text = await exportRes.text();
        return { kind: "text", text, mimeType: exportInfo.mime, filename };
      }
      const arr = await exportRes.arrayBuffer();
      return { kind: "binary", bytes: Buffer.from(arr), mimeType: exportInfo.mime, filename };
    }

    // Regular file → alt=media
    const dlRes = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(externalId)}?alt=media`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } },
    );
    if (!dlRes.ok) {
      await throwDriveApiError("download", dlRes);
    }
    const arr = await dlRes.arrayBuffer();
    return {
      kind: "binary",
      bytes: Buffer.from(arr),
      mimeType: meta.mimeType,
      filename: meta.name,
    };
  },
};

// Export shared OAuth state helpers so routes can use them.
export { signState, verifyState };
export const PROVIDER_ID = PROVIDER;
