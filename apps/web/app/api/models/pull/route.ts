import { NextRequest } from "next/server";
import { ollamaPullStream } from "@/lib/ollama/client";

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name || typeof name !== "string") {
    return new Response(JSON.stringify({ error: "Model name required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const upstream = await ollamaPullStream(name);

    // Relay Ollama's NDJSON stream as SSE
    const encoder = new TextEncoder();
    const reader = upstream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            controller.enqueue(encoder.encode(`data: ${line}\n\n`));
          }
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to pull model. Is Ollama running?" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
