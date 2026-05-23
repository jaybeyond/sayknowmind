-- Team feature, Phase 4 — per-resource sharing (ACL).
--
-- The org model (Phase 3) already gives a team a shared pool: members see
-- every `shared` document/category in their organization. `resource_shares`
-- adds the finer grain on top — granting a SPECIFIC teammate access to a
-- SPECIFIC resource that is otherwise `private`:
--
--   * permission 'view'  -> the grantee can read the resource
--   * permission 'edit'  -> the grantee can also modify/delete it
--
-- `resource_id` is polymorphic (documents.id OR categories.id, both UUID) so
-- it carries no FK; a share row pointing at a deleted resource is harmless
-- (the visibility EXISTS-subquery simply never matches it). `organization_id`
-- keeps shares inside one org and gives a clean cascade on org deletion.

CREATE TABLE IF NOT EXISTS resource_shares (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type    TEXT NOT NULL CHECK (resource_type IN ('document', 'category')),
  resource_id      UUID NOT NULL,
  grantee_user_id  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  permission       TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
  granted_by       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id  TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  -- one grant per (resource, grantee); re-sharing updates the row
  UNIQUE (resource_type, resource_id, grantee_user_id)
);

-- "what is shared with me" — the hot path in every read query
CREATE INDEX IF NOT EXISTS idx_resource_shares_grantee
  ON resource_shares (grantee_user_id);
-- "who is this resource shared with" — the shares-management UI
CREATE INDEX IF NOT EXISTS idx_resource_shares_resource
  ON resource_shares (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_org
  ON resource_shares (organization_id);
