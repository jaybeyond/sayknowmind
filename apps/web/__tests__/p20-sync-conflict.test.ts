/**
 * Property 20: Private Mode sync conflict handling
 * Verify conflict detection, display, and manual resolution.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  detectConflict,
  getPendingConflicts,
  resolveConflict,
  clearResolvedConflicts,
  type SyncConflict,
  type ConflictResolution,
} from "@/lib/sync";

describe("Property 20: Sync conflict handling", () => {
  it("conflict is detected when hashes differ", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 100 }),
        fc.stringMatching(/^[a-f0-9]{8,64}$/),
        fc.stringMatching(/^[a-f0-9]{8,64}$/),
        (filePath, hash1, hash2) => {
          if (hash1 === hash2) return; // skip identical hashes
          const conflict = detectConflict(
            filePath, hash1, new Date(), 1000,
            hash2, new Date(), 1200, "device-2",
          );
          expect(conflict.filePath).toBe(filePath);
          expect(conflict.localVersion.hash).toBe(hash1);
          expect(conflict.remoteVersion.hash).toBe(hash2);
          expect(conflict.resolved).toBe(false);
          expect(conflict.detectedAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("identical files do not create a conflict", () => {
    const hash = "abc123def456";
    expect(() =>
      detectConflict("test.txt", hash, new Date(), 100, hash, new Date(), 100, "dev"),
    ).toThrow("No conflict");
  });

  it("pending conflicts are listed correctly", () => {
    // Clear state first
    clearResolvedConflicts();
    const before = getPendingConflicts().length;

    const conflict = detectConflict(
      "doc.pdf", "hash-a", new Date(), 500,
      "hash-b", new Date(), 600, "phone",
    );

    const pending = getPendingConflicts();
    expect(pending.length).toBeGreaterThanOrEqual(before + 1);
    expect(pending.some((c) => c.id === conflict.id)).toBe(true);
  });

  it("conflict resolution options work correctly", () => {
    const resolutions: ConflictResolution[] = ["keep_local", "keep_remote", "keep_both"];

    for (const resolution of resolutions) {
      const conflict = detectConflict(
        `file-${resolution}.txt`, "aaa", new Date(), 100,
        "bbb", new Date(), 200, "other-device",
      );

      const resolved = resolveConflict(conflict.id, resolution);
      expect(resolved.resolved).toBe(true);
      expect(resolved.resolution).toBe(resolution);
    }
  });

  it("cannot resolve already-resolved conflict", () => {
    const conflict = detectConflict(
      "double-resolve.txt", "x1", new Date(), 100,
      "x2", new Date(), 200, "dev",
    );
    resolveConflict(conflict.id, "keep_local");
    expect(() => resolveConflict(conflict.id, "keep_remote")).toThrow("already resolved");
  });

  it("resolved conflicts can be cleared", () => {
    const c1 = detectConflict("c1.txt", "a", new Date(), 1, "b", new Date(), 2, "d");
    const c2 = detectConflict("c2.txt", "c", new Date(), 1, "d", new Date(), 2, "d");
    resolveConflict(c1.id, "keep_local");
    // c2 remains unresolved

    const cleared = clearResolvedConflicts();
    expect(cleared).toBeGreaterThanOrEqual(1);

    const pending = getPendingConflicts();
    expect(pending.some((c) => c.id === c2.id)).toBe(true);
  });
});
