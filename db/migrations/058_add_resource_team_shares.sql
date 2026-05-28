-- Team feature, Phase 7 — share one resource with MULTIPLE teams.
--
-- The org model scopes a resource to a single home organization
-- (`documents.organization_id`) and `privacy_level='shared'` exposes it to that
-- home team. That is not enough for a user who belongs to several teams and
-- wants the same memory visible in more than one of them.
--
-- `resource_team_shares` is the many-to-many on top: each row grants an extra
-- organization read access to a resource. The home org keeps using
-- `privacy_level`; every OTHER team a resource is shared into gets a row here.
--
-- `resource_id` is polymorphic (documents.id OR categories.id, both UUID) so it
-- carries no FK — a row pointing at a deleted resource is harmless, the
-- visibility EXISTS-subquery simply never matches it. `organization_id` is the
-- team the resource is shared TO; it cascades on org deletion.

CREATE TABLE IF NOT EXISTS resource_team_shares (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type    TEXT NOT NULL CHECK (resource_type IN ('document', 'category')),
  resource_id      UUID NOT NULL,
  organization_id  TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  granted_by       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  -- one share per (resource, team)
  UNIQUE (resource_type, resource_id, organization_id)
);

-- "what is shared into my active team" — the hot path in every read query.
-- The UNIQUE constraint already indexes (resource_type, resource_id,
-- organization_id); this one serves the org-first lookup.
CREATE INDEX IF NOT EXISTS idx_resource_team_shares_org
  ON resource_team_shares (organization_id);
-- "which teams is this resource shared with" — the share-management dialog.
CREATE INDEX IF NOT EXISTS idx_resource_team_shares_resource
  ON resource_team_shares (resource_type, resource_id);
