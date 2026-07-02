/**
 * Property 50: Offline-sync conflict detection & resolution is correct.
 *
 * `lib/relay/conflict-resolver.ts` decides whether two divergent copies of a
 * document collide and which side wins. A wrong decision silently loses a
 * user's edits. Previously untested.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectConflict, resolveConflict } from "@/lib/relay/conflict-resolver";
import type { SyncPayload, RelayConflict, RelayConflictStrategy } from "@/lib/relay/types";

function payload(over: Partial<SyncPayload> = {}): SyncPayload {
  return {
    type: "document",
    action: "update",
    data: {},
    timestamp: Date.UTC(2026, 0, 2),
    hash: "remote-hash",
    ...over,
  };
}

describe("Property 50a: detectConflict", () => {
  it("returns null when hashes match (identical content)", () => {
    const local = { id: "d1", updatedAt: new Date(Date.UTC(2026, 0, 5)), syncHash: "same" };
    expect(detectConflict(local, payload({ hash: "same" }), "dev-1")).toBeNull();
  });

  it("returns null when local has not changed since the remote's base sync time", () => {
    const local = { id: "d1", updatedAt: new Date(Date.UTC(2026, 0, 1)), syncHash: "local" };
    const remote = payload({ hash: "remote", baseSyncedAt: new Date(Date.UTC(2026, 0, 3)).toISOString() });
    expect(detectConflict(local, remote, "dev-1")).toBeNull();
  });

  it("reports a conflict when both sides changed (local newer than base, different hash)", () => {
    const local = { id: "d1", updatedAt: new Date(Date.UTC(2026, 0, 4)), syncHash: "local" };
    const remote = payload({ hash: "remote", baseSyncedAt: new Date(Date.UTC(2026, 0, 2)).toISOString() });
    const c = detectConflict(local, remote, "dev-9");
    expect(c).not.toBeNull();
    expect(c!.documentId).toBe("d1");
    expect(c!.localVersion.hash).toBe("local");
    expect(c!.remoteVersion.hash).toBe("remote");
    expect(c!.remoteVersion.sourceDeviceId).toBe("dev-9");
    expect(c!.resolved).toBe(false);
  });

  it("reports a conflict when there is no base sync time and hashes differ", () => {
    const local = { id: "d1", updatedAt: new Date(Date.UTC(2026, 0, 1)), syncHash: "local" };
    expect(detectConflict(local, payload({ hash: "remote" }), "dev-1")).not.toBeNull();
  });

  it("treats a missing local syncHash as different from any remote hash", () => {
    const local = { id: "d1", updatedAt: new Date(Date.UTC(2026, 0, 4)) };
    expect(detectConflict(local, payload({ hash: "remote" }), "dev-1")).not.toBeNull();
  });
});

describe("Property 50b: resolveConflict", () => {
  function conflict(localTime: number, remoteTime: number): RelayConflict {
    return {
      id: "c1",
      documentId: "d1",
      localVersion: { updatedAt: new Date(localTime), hash: "l" },
      remoteVersion: { updatedAt: new Date(remoteTime), hash: "r", sourceDeviceId: "dev" },
      detectedAt: new Date(),
      resolved: false,
    };
  }

  it("last_write_wins picks the strictly newer side", () => {
    expect(resolveConflict(conflict(200, 100), "last_write_wins")).toEqual({ winner: "local", createCopy: false });
    expect(resolveConflict(conflict(100, 200), "last_write_wins")).toEqual({ winner: "remote", createCopy: false });
  });

  it("keep_local / keep_remote are deterministic", () => {
    expect(resolveConflict(conflict(1, 2), "keep_local")).toEqual({ winner: "local", createCopy: false });
    expect(resolveConflict(conflict(2, 1), "keep_remote")).toEqual({ winner: "remote", createCopy: false });
  });

  it("keep_both preserves local and forks the remote into a copy (no data loss)", () => {
    expect(resolveConflict(conflict(1, 2), "keep_both")).toEqual({ winner: "local", createCopy: true });
  });

  it("only keep_both ever creates a copy", () => {
    const strategies: RelayConflictStrategy[] = ["last_write_wins", "keep_local", "keep_remote", "keep_both"];
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.constantFrom(...strategies), (lt, rt, strat) => {
        const r = resolveConflict(conflict(lt, rt), strat);
        expect(r.createCopy).toBe(strat === "keep_both");
        expect(["local", "remote"]).toContain(r.winner);
      }),
      { numRuns: 80 },
    );
  });
});
