/**
 * Lightweight, in-memory presence tracking for "who's online" avatars.
 *
 * Deliberately NOT persisted: presence is ephemeral, so a redeploy resetting it
 * is correct behavior, and this avoids a DB write on every heartbeat. Kept on a
 * globalThis singleton so Next dev hot-reloads don't drop the map (same trick as
 * the event bus).
 *
 * Caveat: single-process only. If the web app is ever scaled to multiple
 * instances, presence would fragment per instance — swap this for a Redis/relay
 * TTL set at that point. (Railway currently runs one web instance.)
 */
export interface PresenceUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface PresenceEntry extends PresenceUser {
  organizationId: string;
  lastSeen: number;
}

/** A user counts as online if seen within this window. */
const ONLINE_WINDOW_MS = 45_000;

const globalForPresence = globalThis as unknown as { __presence?: Map<string, PresenceEntry> };
const presence: Map<string, PresenceEntry> =
  globalForPresence.__presence ?? (globalForPresence.__presence = new Map());

/** Record a heartbeat: mark this user online in their org (given a clock). */
export function touchPresence(user: PresenceUser, organizationId: string, now: number): void {
  presence.set(user.id, { ...user, organizationId, lastSeen: now });
}

/** Members of `organizationId` seen within the online window, most-recent first. */
export function onlineInOrg(organizationId: string, now: number, excludeUserId?: string): PresenceUser[] {
  const out: Array<PresenceEntry> = [];
  for (const [id, entry] of presence) {
    if (now - entry.lastSeen > ONLINE_WINDOW_MS) {
      presence.delete(id); // opportunistic prune of stale entries
      continue;
    }
    if (entry.organizationId !== organizationId) continue;
    if (excludeUserId && entry.id === excludeUserId) continue;
    out.push(entry);
  }
  out.sort((a, b) => b.lastSeen - a.lastSeen);
  return out.map(({ id, name, email, image }) => ({ id, name, email, image }));
}
