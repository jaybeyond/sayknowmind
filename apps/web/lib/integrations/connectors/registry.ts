/**
 * Connector registry. Adding a new provider = adding one entry here.
 * The rest of the system (routes, UI catalogue, OAuth flow) reads from this
 * map so no provider name is hardcoded outside the registry.
 */

import type { Connector, ConnectorId } from "./_interface";
import { googleDriveConnector } from "./google-drive";
// Gmail is implemented but currently hidden from the UI catalogue. Re-enable
// by uncommenting both lines below once the OAuth consent screen carries
// `gmail.readonly`. Existing Gmail tokens stay in the DB until then.
// import { gmailConnector } from "./gmail";

const CONNECTORS: Partial<Record<ConnectorId, Connector>> = {
  "google-drive": googleDriveConnector,
  // "gmail": gmailConnector,
  // Future:
  //   "notion": notionConnector,
  //   "dropbox": dropboxConnector,
  //   "github": githubConnector,
  //   ...
};

export function getConnector(id: string): Connector | null {
  return CONNECTORS[id as ConnectorId] ?? null;
}

export function listConnectors(): Connector[] {
  return Object.values(CONNECTORS).filter((c): c is Connector => Boolean(c));
}
