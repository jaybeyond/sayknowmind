/**
 * Real-time collaboration backend (Collaborative docs, Phase 2).
 *
 * A Hocuspocus (Yjs) server that authorizes each connection with a doc-scoped
 * collab token and persists the merged CRDT state to Postgres (`doc_collab`).
 * The room name IS the document id, so a token only opens the document it was
 * minted for. Read-only collaborators connect but cannot mutate the doc.
 *
 * This owns the live CRDT only. The searchable at-rest projection
 * (`documents.content` + `metadata.blocknote`) is written by the web client's
 * debounced autosave — see COLLAB_DOCS_PLAN.md "source-of-truth rule".
 */
import { Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import type { Pool } from "pg";
import { verifyCollabToken } from "../auth/collab-token.js";

export function createCollabServer(pool: Pool): Hocuspocus {
  return new Hocuspocus({
    name: "sayknowmind-collab",

    // Authorize the connection: verify the token's signature, then enforce
    // that it was minted for THIS document. canWrite=false → read-only.
    async onAuthenticate({ token, documentName, connection }) {
      const payload = verifyCollabToken(token);
      if (!payload) {
        throw new Error("Invalid or expired collab token");
      }
      if (payload.doc !== documentName) {
        throw new Error("Token not valid for this document");
      }

      connection.readOnly = !payload.canWrite;

      return {
        userId: payload.sub,
        organizationId: payload.org,
        canWrite: payload.canWrite,
      };
    },

    // Resume the exact CRDT history from Postgres, if any.
    async onLoadDocument({ documentName, document }) {
      const result = await pool.query(
        `SELECT state FROM doc_collab WHERE document_id = $1`,
        [documentName],
      );
      const row = result.rows[0];
      if (row?.state) {
        Y.applyUpdate(document, new Uint8Array(row.state as Buffer));
      }
      return document;
    },

    // Persist the merged state (debounced by Hocuspocus + on last disconnect).
    async onStoreDocument({ documentName, document }) {
      const update = Y.encodeStateAsUpdate(document);
      await pool.query(
        `INSERT INTO doc_collab (document_id, state, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (document_id)
         DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
        [documentName, Buffer.from(update)],
      );
    },
  });
}
