import { describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "../src/session-registry.js";

const IDLE_MS = 30 * 60_000;

function makeRegistry(opts?: {
  maxSessions?: number;
  onEvict?: (sid: string, reason: "idle" | "cap") => void;
}) {
  let nowMs = 0;
  const registry = new SessionRegistry<string>({
    idleMs: IDLE_MS,
    maxSessions: opts?.maxSessions ?? 256,
    now: () => nowMs,
    onEvict: opts?.onEvict,
  });
  return { registry, advance: (ms: number) => (nowMs += ms) };
}

function makeServer() {
  return { close: vi.fn().mockResolvedValue(undefined) };
}

describe("SessionRegistry idle sweep", () => {
  it("drops a session once it has been idle past idleMs", async () => {
    const { registry, advance } = makeRegistry();
    const server = makeServer();
    registry.register("a", "transport", server);

    advance(IDLE_MS);
    registry.sweepIdle();
    expect(registry.has("a")).toBe(true);

    advance(1);
    registry.sweepIdle();
    expect(registry.has("a")).toBe(false);
    // close is deferred to a microtask; let it flush before asserting
    await Promise.resolve();
    expect(server.close).toHaveBeenCalled();
  });

  it("touch resets the idle clock", () => {
    const { registry, advance } = makeRegistry();
    registry.register("a", "transport", makeServer());

    advance(IDLE_MS - 1);
    registry.touch("a");
    advance(IDLE_MS - 1);
    registry.sweepIdle();
    expect(registry.has("a")).toBe(true);
  });

  it("never drops a session whose stream is open, however idle", () => {
    const { registry, advance } = makeRegistry();
    const server = makeServer();
    registry.register("a", "transport", server, () => true);

    advance(IDLE_MS * 10);
    registry.sweepIdle();
    expect(registry.has("a")).toBe(true);
    expect(server.close).not.toHaveBeenCalled();
  });

  it("restarts the idle clock when the sweep sees an open stream", () => {
    const { registry, advance } = makeRegistry();
    let streamOpen = true;
    registry.register("a", "transport", makeServer(), () => streamOpen);

    // Stream stays open across many sweeps, then closes.
    advance(IDLE_MS * 3);
    registry.sweepIdle();
    streamOpen = false;

    // Idle countdown starts from the last sweep, not from registration.
    advance(IDLE_MS);
    registry.sweepIdle();
    expect(registry.has("a")).toBe(true);
    advance(1);
    registry.sweepIdle();
    expect(registry.has("a")).toBe(false);
  });
});

describe("SessionRegistry cap eviction", () => {
  it("evicts the least-recently-used session over the cap", () => {
    const evicted: string[] = [];
    const { registry, advance } = makeRegistry({
      maxSessions: 2,
      onEvict: (sid) => evicted.push(sid),
    });
    registry.register("oldest", "t", makeServer());
    advance(1);
    registry.register("middle", "t", makeServer());
    advance(1);
    registry.register("newest", "t", makeServer());

    expect(evicted).toEqual(["oldest"]);
    expect(registry.size).toBe(2);
    expect(registry.has("oldest")).toBe(false);
  });

  it("prefers evicting sessions without an open stream", () => {
    const { registry, advance } = makeRegistry({ maxSessions: 2 });
    registry.register("streaming", "t", makeServer(), () => true);
    advance(1);
    registry.register("quiet", "t", makeServer());
    advance(1);
    registry.register("new", "t", makeServer());

    // "streaming" is older but protected; "quiet" goes instead.
    expect(registry.has("streaming")).toBe(true);
    expect(registry.has("quiet")).toBe(false);
    expect(registry.has("new")).toBe(true);
  });

  it("falls back to plain LRU when every session has an open stream", () => {
    const { registry, advance } = makeRegistry({ maxSessions: 2 });
    registry.register("a", "t", makeServer(), () => true);
    advance(1);
    registry.register("b", "t", makeServer(), () => true);
    advance(1);
    registry.register("c", "t", makeServer(), () => true);

    expect(registry.size).toBe(2);
    expect(registry.has("a")).toBe(false);
  });
});

describe("SessionRegistry drop", () => {
  it("resolves after server.close and is idempotent", async () => {
    const { registry } = makeRegistry();
    const server = makeServer();
    registry.register("a", "t", server);

    await registry.drop("a");
    expect(server.close).toHaveBeenCalledTimes(1);
    await registry.drop("a");
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("swallows close errors from an already torn down transport", async () => {
    const { registry } = makeRegistry();
    const server = { close: vi.fn().mockRejectedValue(new Error("gone")) };
    registry.register("a", "t", server);

    await expect(registry.drop("a")).resolves.toBeUndefined();
    expect(registry.has("a")).toBe(false);
  });
});
