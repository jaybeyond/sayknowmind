-- Team feature, Phase 1 — better-auth `organization` plugin tables.
--
-- SayKnowMind is gaining a team/collaboration feature. We adopt
-- better-auth's official `organization` plugin instead of reviving the
-- dead EdgeQuake `tenants/workspaces/memberships` tables (those FK to a
-- UUID `users` table, but real login users live in better-auth `"user"`
-- whose id is TEXT — incompatible).
--
-- In our model one better-auth `organization` IS a "team": its members
-- share a knowledge pool. The nested better-auth `teams` sub-feature is
-- deliberately NOT enabled — per-resource fine-grained sharing is handled
-- later by a dedicated `resource_shares` ACL table, not by org sub-teams.
--
-- Column names/types mirror the plugin's runtime schema
-- (better-auth@1.5.6 dist/plugins/organization/organization.mjs):
--   organization: id, name, slug(unique), logo, createdAt, metadata
--   member:       id, organizationId, userId, role(default 'member'), createdAt
--   invitation:   id, organizationId, email, role, status(default 'pending'),
--                 expiresAt, createdAt, inviterId
--   session:      + activeOrganizationId
-- camelCase identifiers are quoted to match better-auth's Kysely adapter,
-- exactly like db/init/07-better-auth.sql.
--
-- This migration is purely ADDITIVE: no existing table loses a column and
-- no query reads `organization` yet (that starts in Phase 2). Safe to run
-- ahead of the application deploy.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organization (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  logo        TEXT,
  metadata    TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member (
  id               TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "userId"         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member',
  "createdAt"      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invitation (
  id               TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  role             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  "expiresAt"      TIMESTAMP NOT NULL,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT NOW(),
  "inviterId"      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

-- better-auth's organization plugin stores the user's active team on the
-- session row.
ALTER TABLE session
  ADD COLUMN IF NOT EXISTS "activeOrganizationId" TEXT
  REFERENCES organization(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Indexes (plugin marks organizationId/userId/email/slug as indexed)
-- ---------------------------------------------------------------------------

-- A user can only be a member of a given org once.
CREATE UNIQUE INDEX IF NOT EXISTS member_org_user_unique
  ON member ("organizationId", "userId");
CREATE INDEX IF NOT EXISTS member_user_id_idx        ON member ("userId");
CREATE INDEX IF NOT EXISTS member_org_id_idx         ON member ("organizationId");
CREATE INDEX IF NOT EXISTS invitation_org_id_idx     ON invitation ("organizationId");
CREATE INDEX IF NOT EXISTS invitation_email_idx      ON invitation (email);
CREATE INDEX IF NOT EXISTS session_active_org_id_idx ON session ("activeOrganizationId");

-- ---------------------------------------------------------------------------
-- Backfill — every existing user gets a personal organization
-- ---------------------------------------------------------------------------
-- Each current user becomes the sole `owner` of their own personal org so
-- that, once Phase 2 attaches `organization_id` to resources, nothing is
-- left orphaned. Idempotent: users who already have a membership are skipped.

DO $$
DECLARE
  u           RECORD;
  new_org_id  TEXT;
BEGIN
  FOR u IN SELECT id, name, email FROM "user" LOOP
    IF EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id) THEN
      CONTINUE;
    END IF;

    new_org_id := replace(gen_random_uuid()::text, '-', '');

    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (
      new_org_id,
      coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)) || ' (Personal)',
      'personal-' || u.id,        -- u.id is unique -> slug is unique
      NOW()
    );

    INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
    VALUES (replace(gen_random_uuid()::text, '-', ''), new_org_id, u.id, 'owner', NOW());
  END LOOP;
END $$;

-- Point live sessions at the user's (now-existing) personal org so users
-- already signed in get a team context without re-authenticating.
UPDATE session s
SET "activeOrganizationId" = (
  SELECT m."organizationId"
  FROM member m
  WHERE m."userId" = s."userId"
  ORDER BY m."createdAt" ASC
  LIMIT 1
)
WHERE s."activeOrganizationId" IS NULL;
