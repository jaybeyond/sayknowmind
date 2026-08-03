/**
 * Session registry with idle eviction and a hard cap.
 *
 * Each live session pins a whole McpServer (every tool's input schema is
 * rebuilt per session), so an entry that is never removed costs hundreds of
 * KB for the lifetime of the process.
 *
 * The SDK only reaches transport.close() — and therefore our onclose cleanup —
 * when the client sends an explicit DELETE /mcp. Clients that crash, lose the
 * network, or simply stop talking never send it, so the registry MUST expire
 * entries on its own. Without the sweeper this map grows monotonically until
 * the container is OOM-killed.
 *
 * Extracted from index.ts so the eviction rules can be regression-tested with
 * an injectable clock (MR !7 review).
 */

interface Closeable {
  close(): Promise<void> | void;
}

export interface SessionEntry<T> {
  transport: T;
  server: Closeable;
  lastSeen: number;
  /** A still-open HTTP stream counts as activity even with no recent messages. */
  isStreamOpen?: () => boolean;
}

export interface SessionRegistryOptions {
  /** Evict a session after this long with no request touching it. */
  idleMs: number;
  /** Hard ceiling so a misbehaving or hostile client cannot exhaust memory. */
  maxSessions: number;
  /** Clock override for tests. */
  now?: () => number;
  onEvict?: (sid: string, reason: "idle" | "cap") => void;
}

export class SessionRegistry<T> {
  private readonly sessions = new Map<string, SessionEntry<T>>();
  private readonly idleMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;
  private readonly onEvict?: (sid: string, reason: "idle" | "cap") => void;

  constructor(opts: SessionRegistryOptions) {
    this.idleMs = opts.idleMs;
    this.maxSessions = opts.maxSessions;
    this.now = opts.now ?? Date.now;
    this.onEvict = opts.onEvict;
  }

  register(
    sid: string,
    transport: T,
    server: Closeable,
    isStreamOpen?: () => boolean,
  ): void {
    this.sessions.set(sid, {
      transport,
      server,
      lastSeen: this.now(),
      isStreamOpen,
    });
    this.evictOverCap();
  }

  touch(sid: string): void {
    const session = this.sessions.get(sid);
    if (session) session.lastSeen = this.now();
  }

  has(sid: string): boolean {
    return this.sessions.has(sid);
  }

  get(sid: string): SessionEntry<T> | undefined {
    return this.sessions.get(sid);
  }

  /** Remove the map entry without closing — for a transport's own onclose. */
  remove(sid: string): void {
    this.sessions.delete(sid);
  }

  get size(): number {
    return this.sessions.size;
  }

  keys(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Drop a session and release its transport + server. The map entry is
   * removed first so the transport's own onclose handler is a harmless no-op
   * re-delete. Resolves once the server has finished closing, so shutdown can
   * genuinely drain instead of firing and forgetting.
   */
  drop(sid: string): Promise<void> {
    const session = this.sessions.get(sid);
    if (!session) return Promise.resolve();
    this.sessions.delete(sid);
    // McpServer.close() cascades to transport.close().
    return Promise.resolve()
      .then(() => session.server.close())
      .catch(() => {
        /* transport already torn down — nothing left to release */
      });
  }

  sweepIdle(): void {
    const now = this.now();
    for (const [sid, session] of this.sessions) {
      // A live stream is an active client even with no recent messages.
      if (session.isStreamOpen?.()) {
        session.lastSeen = now;
        continue;
      }
      if (now - session.lastSeen > this.idleMs) {
        this.onEvict?.(sid, "idle");
        void this.drop(sid);
      }
    }
  }

  /** Prefer evicting sessions with no live stream; fall back to plain LRU. */
  private evictOverCap(): void {
    while (this.sessions.size > this.maxSessions) {
      let victim: string | undefined;
      let oldest = Infinity;
      for (const [sid, session] of this.sessions) {
        if (session.isStreamOpen?.()) continue;
        if (session.lastSeen < oldest) {
          oldest = session.lastSeen;
          victim = sid;
        }
      }
      if (!victim) {
        for (const [sid, session] of this.sessions) {
          if (session.lastSeen < oldest) {
            oldest = session.lastSeen;
            victim = sid;
          }
        }
      }
      if (!victim) return;
      this.onEvict?.(victim, "cap");
      void this.drop(victim);
    }
  }
}
