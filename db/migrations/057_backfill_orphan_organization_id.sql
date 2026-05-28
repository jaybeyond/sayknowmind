-- Heal rows that still carry a NULL organization_id after the Phase 2 backfill.
--
-- Two sources produce such orphans:
--   1. Rows whose owner had no personal org at the moment 054 ran.
--   2. The relay offline-sync path historically inserted `documents` without an
--      organization_id (it predated the team feature), leaving pulled documents
--      invisible to every org-scoped visibility helper.
--
-- This migration re-runs the exact personal-org backfill from 054 for any row
-- that is still NULL. It is additive and idempotent: rows already scoped to an
-- org are untouched, and rows whose owner still has no personal org stay NULL
-- (harmless — they remain user-scoped only, same as before).
--
-- Note: this maps orphans to their OWNER's personal org, matching the 054
-- convention. It deliberately does not reassign data into team orgs.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'documents', 'categories', 'tags',
    'conversations', 'ingestion_jobs', 'shared_content'
  ]
  LOOP
    EXECUTE format(
      'UPDATE %I t SET organization_id = o.id '
      'FROM organization o '
      'WHERE o.slug = ''personal-'' || t.user_id '
      '  AND t.organization_id IS NULL', tbl);
  END LOOP;
END $$;
