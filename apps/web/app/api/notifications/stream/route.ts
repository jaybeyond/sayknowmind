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

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      // Register listener
      const unsubscribe = addSSEListener(userId, (notification) => {
        const data = JSON.stringify(notification);
        controller.enqueue(encoder.encode(`event: notification\ndata: ${data}\n\n`));
      });

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Cleanup on close
      const cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
      };

      // AbortSignal is not directly accessible here, so we rely on
      // the stream being closed when the client disconnects
      controller.enqueue(encoder.encode(""));

      // Store cleanup for cancel
      (stream as unknown as { _cleanup?: () => void })._cleanup = cleanup;
    },
    cancel() {
      const cleanup = (stream as unknown as { _cleanup?: () => void })._cleanup;
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
