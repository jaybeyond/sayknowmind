import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { addSSEListener } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** GET /api/notifications/stream — SSE real-time notification stream */
export async function GET() {
  let userId: string | null = null;
  try {
    userId = await getUserIdFromRequest();
  } catch {
    return new Response("Auth error", { status: 401 });
  }
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      // Register listener
      const unsubscribe = addSSEListener(userId, (notification) => {
        try {
          const data = JSON.stringify(notification);
          controller.enqueue(encoder.encode(`event: notification\ndata: ${data}\n\n`));
        } catch { /* stream closed */ }
      });

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Store cleanup in outer scope (avoids TDZ referencing `stream` inside its own constructor)
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
