import { pool } from "@/lib/db";

// Jenkins UAT image updates currently replace only the web container and do
// not run db/migrations. These additive guards keep existing databases
// compatible with the canonical migrations without replaying destructive or
// unrelated migration history on application startup.

const SHARED_CONTENT_SCHEMA_SQL = `
  ALTER TABLE shared_content
    ADD COLUMN IF NOT EXISTS encryption_method VARCHAR(50),
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS share_token VARCHAR(32),
    ADD COLUMN IF NOT EXISTS passphrase_hash TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

  UPDATE shared_content
     SET share_token = replace(gen_random_uuid()::text, '-', '')
   WHERE share_token IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_content_share_token
    ON shared_content (share_token);
`;

const KNOWLEDGE_VISIBILITY_SCHEMA_SQL = `
  ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS privacy_level VARCHAR(20) DEFAULT 'private';

  ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS privacy_level VARCHAR(20) DEFAULT 'private',
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'collection';

  CREATE INDEX IF NOT EXISTS idx_documents_organization_id
    ON documents (organization_id);
  CREATE INDEX IF NOT EXISTS idx_categories_organization_id
    ON categories (organization_id);
  CREATE INDEX IF NOT EXISTS idx_categories_kind
    ON categories (kind);

  UPDATE documents d
     SET organization_id = o.id
    FROM organization o
   WHERE d.organization_id IS NULL
     AND o.slug = 'personal-' || d.user_id;

  UPDATE categories c
     SET organization_id = o.id
    FROM organization o
   WHERE c.organization_id IS NULL
     AND o.slug = 'personal-' || c.user_id;

  UPDATE shared_content sc
     SET organization_id = o.id
    FROM organization o
   WHERE sc.organization_id IS NULL
     AND o.slug = 'personal-' || sc.user_id;

  CREATE TABLE IF NOT EXISTS resource_shares (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type    TEXT NOT NULL CHECK (resource_type IN ('document', 'category')),
    resource_id      UUID NOT NULL,
    grantee_user_id  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    permission       TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
    granted_by       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    organization_id  TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (resource_type, resource_id, grantee_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_resource_shares_grantee
    ON resource_shares (grantee_user_id);
  CREATE INDEX IF NOT EXISTS idx_resource_shares_resource
    ON resource_shares (resource_type, resource_id);
  CREATE INDEX IF NOT EXISTS idx_resource_shares_org
    ON resource_shares (organization_id);

  CREATE TABLE IF NOT EXISTS resource_team_shares (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type    TEXT NOT NULL CHECK (resource_type IN ('document', 'category')),
    resource_id      UUID NOT NULL,
    organization_id  TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    granted_by       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (resource_type, resource_id, organization_id)
  );

  CREATE INDEX IF NOT EXISTS idx_resource_team_shares_org
    ON resource_team_shares (organization_id);
  CREATE INDEX IF NOT EXISTS idx_resource_team_shares_resource
    ON resource_team_shares (resource_type, resource_id);
`;

let sharedContentSchemaPromise: Promise<void> | null = null;
let knowledgeVisibilitySchemaPromise: Promise<void> | null = null;

export function ensureSharedContentSchema(): Promise<void> {
  if (sharedContentSchemaPromise) return sharedContentSchemaPromise;
  const pending = pool
    .query(SHARED_CONTENT_SCHEMA_SQL)
    .then(() => undefined)
    .catch((error: unknown) => {
      sharedContentSchemaPromise = null;
      throw error;
    });
  sharedContentSchemaPromise = pending;
  return pending;
}

export function ensureKnowledgeVisibilitySchema(): Promise<void> {
  if (knowledgeVisibilitySchemaPromise) return knowledgeVisibilitySchemaPromise;
  const pending = pool
    .query(KNOWLEDGE_VISIBILITY_SCHEMA_SQL)
    .then(() => undefined)
    .catch((error: unknown) => {
      knowledgeVisibilitySchemaPromise = null;
      throw error;
    });
  knowledgeVisibilitySchemaPromise = pending;
  return pending;
}

export async function ensureKnowledgeSchema(): Promise<void> {
  await ensureSharedContentSchema();
  await ensureKnowledgeVisibilitySchema();
}
