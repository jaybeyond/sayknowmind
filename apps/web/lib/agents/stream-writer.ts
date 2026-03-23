/**
 * SSE stream writer for the agentic chat pipeline.
 * Encodes typed events into Server-Sent Events format.
 */

export interface StreamSource {
  id: string;
  title: string;
  url?: string;
  excerpt: string;
  score: number;
}

export class StreamWriter {
  private encoder = new TextEncoder();

  constructor(private controller: ReadableStreamDefaultController) {}

  /** Emit a status event (thinking, searching, etc.) */
  status(phase: string, message: string): void {
    this.emit({ type: "status", phase, message });
  }

  /** Emit a thinking log line — shows the agent's internal reasoning */
  log(message: string): void {
    this.emit({ type: "log", message });
  }

  /** Emit found sources */
  sources(sources: StreamSource[]): void {
    this.emit({ type: "sources", sources });
  }

  /** Emit an answer token */
  token(text: string): void {
    this.emit({ type: "answer", token: text });
  }

  /** Emit completion event */
  done(meta: { conversationId: string; messageId: string }): void {
    this.emit({ type: "done", ...meta });
  }

  /** Emit an error event (non-fatal, stream continues) */
  error(message: string): void {
    this.emit({ type: "error", message });
  }

  /** Close the stream */
  close(): void {
    this.controller.close();
  }

  private emit(data: Record<string, unknown>): void {
    const line = `data: ${JSON.stringify(data)}\n\n`;
    this.controller.enqueue(this.encoder.encode(line));
  }
}
