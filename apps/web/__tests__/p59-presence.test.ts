/**
 * Property 59: Presence tracking — org scoping, self-exclusion, staleness.
 *
 * The tasks page shows "who's online" from an in-memory presence map. This pins
 * the rules that matter: a heartbeat marks a user online, the online list is
 * scoped to one org, excludes the caller, and drops users past the window.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

// Fresh module per test so the module-level presence Map doesn't leak between
// cases (it lives on globalThis).
async function freshPresence() {
  vi.resetModules();
  delete (globalThis as { __presence?: unknown }).__presence;
  return import("@/lib/presence");
}

const user = (id: string) => ({ id, name: id, email: `${id}@x.dev`, image: null });

describe("presence", () => {
  beforeEach(() => {
    delete (globalThis as { __presence?: unknown }).__presence;
  });

  it("marks a user online and lists org peers, excluding the caller", async () => {
    const { touchPresence, onlineInOrg } = await freshPresence();
    const t0 = 1_000_000;
    touchPresence(user("alice"), "org-1", t0);
    touchPresence(user("bob"), "org-1", t0);

    const forAlice = onlineInOrg("org-1", t0, "alice");
    expect(forAlice.map((u) => u.id)).toEqual(["bob"]);
  });

  it("does not leak presence across organizations", async () => {
    const { touchPresence, onlineInOrg } = await freshPresence();
    const t0 = 1_000_000;
    touchPresence(user("alice"), "org-1", t0);
    touchPresence(user("carol"), "org-2", t0);

    expect(onlineInOrg("org-1", t0).map((u) => u.id)).toEqual(["alice"]);
    expect(onlineInOrg("org-2", t0).map((u) => u.id)).toEqual(["carol"]);
  });

  it("drops users not seen within the online window", async () => {
    const { touchPresence, onlineInOrg } = await freshPresence();
    const t0 = 1_000_000;
    touchPresence(user("alice"), "org-1", t0);
    // 46s later — past the 45s window.
    expect(onlineInOrg("org-1", t0 + 46_000)).toEqual([]);
    // A fresh beat brings them back.
    touchPresence(user("alice"), "org-1", t0 + 46_000);
    expect(onlineInOrg("org-1", t0 + 46_000).map((u) => u.id)).toEqual(["alice"]);
  });

  it("orders by most-recently-seen first", async () => {
    const { touchPresence, onlineInOrg } = await freshPresence();
    const t0 = 1_000_000;
    touchPresence(user("alice"), "org-1", t0);
    touchPresence(user("bob"), "org-1", t0 + 5_000);
    expect(onlineInOrg("org-1", t0 + 5_000).map((u) => u.id)).toEqual(["bob", "alice"]);
  });
});
