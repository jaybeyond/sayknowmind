/**
 * Cloud connector abstraction.
 *
 * Each provider (Google Drive, Notion, Dropbox, GitHub, ...) implements this
 * interface so that the routes, UI, and ingestion glue stay generic.
 *
 * Hard rule: every method takes `userId` and only acts on that user's data.
 * Tokens are looked up by (userId, provider) and used solely for that
 * user's API calls. Cross-user data access is structurally impossible.
 */

/** Identifier of a connector. Add new providers here. */
export type ConnectorId =
  | "google-drive"
  | "google-docs"
  | "google-sheets"
  | "google-slides"
  | "gmail"
  | "notion"
  | "dropbox"
  | "onedrive"
  | "github"
  | "gitlab"
  | "slack-files"
  | "discord-files";

/** A file or item on the provider side, normalised to the shape we need. */
export interface ConnectorItem {
  /** Provider-side stable ID (Google fileId, Notion page ID, GitHub repo full_name+path, ...). */
  externalId: string;
  /** Display name. */
  name: string;
  /** "file" | "folder" | "page" | "channel" — provider tells us what kind of node this is. */
  kind: "file" | "folder";
  /** MIME type if the provider exposes one. */
  mimeType?: string;
  /** Byte size if known (folders generally don't have one). */
  size?: number;
  /** Last modification time at the provider. Used for change detection. */
  modifiedAt?: string;
  /** Canonical URL at the provider (so the UI can deep-link). */
  externalUrl?: string;
  /** Path/breadcrumb if the provider models hierarchy (Drive folder path, etc). */
  path?: string;
  /** Whether the item can be downloaded directly. False = needs export (e.g. Google Docs). */
  downloadable: boolean;
  /** Provider-specific extras the UI might want to show (icons, owner, etc). */
  extra?: Record<string, unknown>;
  /**
   * Set by the list route (not by connector implementations): true when the
   * current user has previously imported this exact item from this account.
   */
  alreadyImported?: boolean;
  /** Set by the list route: id of the prior import's document, if any. */
  importedDocumentId?: string;
}

/** Pagination cursor abstraction. Opaque to the caller. */
export interface ConnectorListPage {
  items: ConnectorItem[];
  nextCursor?: string;
}

/** A single account a user has connected at this provider. */
export interface ConnectedAccount {
  accountId: string;
  email?: string;
  label?: string;
  scope?: string;
  connectedAt: string;
}

/** Metadata describing a provider for the UI catalogue. */
export interface ConnectorMeta {
  id: ConnectorId;
  /** Human display name. */
  displayName: string;
  /** Short pitch shown on the connect card. */
  description: string;
  /** OAuth scopes requested at connect time. */
  scopes: readonly string[];
  /** Whether this provider supports listing a hierarchy (vs flat search). */
  supportsBrowse: boolean;
  /** Whether this provider supports exporting native docs to plain formats. */
  supportsExport: boolean;
}

/** Result of downloading an item. Either a binary blob or pre-extracted text. */
export type ConnectorDownload =
  | { kind: "binary"; bytes: Buffer; mimeType: string; filename: string }
  | { kind: "text"; text: string; mimeType: string; filename: string };

/**
 * The runtime contract every connector implements.
 *
 * Implementations must NOT cache tokens across users; always fetch the active
 * token for the given (userId, accountId) on each call.
 */
export interface Connector {
  meta: ConnectorMeta;

  /**
   * Build the OAuth authorization URL for the user to visit. State is signed
   * so the callback can verify it's the same user who started the flow.
   */
  buildAuthUrl(args: { userId: string; state: string }): string;

  /**
   * Exchange an OAuth code for tokens, then persist them under (userId,
   * provider, accountId). Returns the connected account info for the UI.
   */
  handleOAuthCallback(args: {
    userId: string;
    code: string;
  }): Promise<ConnectedAccount>;

  /**
   * Disconnect a single connected account. Revokes the token at the provider
   * if possible, then removes the row from user_integration_tokens.
   */
  disconnect(args: { userId: string; accountId: string }): Promise<void>;

  /**
   * List items at a folder/parent. `parentId` is provider-specific
   * (Google Drive folderId, Notion parent page ID, GitHub repo path).
   * `parentId` undefined means "root".
   *
   * `filters` is an open-ended bag of provider-specific knobs. Examples:
   *   - Google Drive: `mimeTypes` (string[]) restricts the returned items
   *   - Gmail:        `q` (string) is a Gmail search query
   * Connectors should ignore filters they don't understand.
   */
  list(args: {
    userId: string;
    accountId: string;
    parentId?: string;
    cursor?: string;
    pageSize?: number;
    filters?: Record<string, string | string[]>;
  }): Promise<ConnectorListPage>;

  /**
   * Fetch the bytes (or extracted text) of a single item, ready to feed
   * into the ingestion pipeline.
   */
  download(args: {
    userId: string;
    accountId: string;
    externalId: string;
  }): Promise<ConnectorDownload>;
}
