import { EventEmitter } from "events";

/**
 * Server-side event bus for real-time notifications.
 * Singleton — survives across API routes in the same process.
 *
 * Events:
 *   "document:created"  → { id, title, userId }
 *   "document:updated"  → { id, userId }
 *   "document:deleted"  → { id, userId }
 *   "ingest:completed"  → { documentId, userId, jobId }
 *   "ingest:failed"     → { documentId, userId, jobId, error }
 */

const globalForEvents = globalThis as unknown as { __eventBus?: EventEmitter };

export const eventBus: EventEmitter =
  globalForEvents.__eventBus ?? (globalForEvents.__eventBus = new EventEmitter());

// Allow many SSE listeners without warning
eventBus.setMaxListeners(200);

export type DocumentEvent = {
  type: "document:created" | "document:updated" | "document:deleted" | "ingest:completed" | "ingest:failed";
  documentId: string;
  userId: string;
  title?: string;
  jobId?: string;
  error?: string;
  timestamp: string;
};

/** Emit a document event to all connected SSE clients */
export function emitDocumentEvent(event: Omit<DocumentEvent, "timestamp">) {
  eventBus.emit("document-event", { ...event, timestamp: new Date().toISOString() });
}
