-- Team feature, Phase 3 — default new resources to team-visible.
--
-- Product decision: inside a team, a freshly created document or collection
-- is shared with the whole team by default (members opt OUT to 'private',
-- rather than opting in). So the column default flips 'private' -> 'shared'.
--
-- EXISTING rows are deliberately left untouched: they keep whatever
-- privacy_level they had (mostly 'private', the old default). A personal org
-- has a single member, so the value is moot until the owner invites someone;
-- at that point they decide per-resource what to expose. Silently exposing a
-- user's whole back-catalogue the moment they form a team would be wrong.
--
-- privacy_level exists only on `documents` and `categories`
-- (db/init/06-privacy-levels.sql); no other resource table has it.

ALTER TABLE documents  ALTER COLUMN privacy_level SET DEFAULT 'shared';
ALTER TABLE categories ALTER COLUMN privacy_level SET DEFAULT 'shared';
