import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { eventBus, type DocumentEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/stream — Server-Sent Events for real-time document updates.
 * Each connected client receives only events for their own userId.
 */
export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send keepalive comment immediately so the connection is established
      controller.enqueue(encoder.encode(": connected\n\n"));

      const onEvent = (event: DocumentEvent) => {
        // Only send events belonging to this user
        if (event.userId !== userId) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Client disconnected
          cleanup();
        }
      };

      // Keepalive every 30s to prevent proxy/CDN timeouts
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 30_000);

      function cleanup() {
        eventBus.off("document-event", onEvent);
        clearInterval(keepalive);
      }

      eventBus.on("document-event", onEvent);

      // Cleanup when the client disconnects (stream is cancelled)
      // The stream controller's cancel signal triggers this
    },
    cancel() {
      // ReadableStream cancel — listener cleanup is handled by the closure above
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
