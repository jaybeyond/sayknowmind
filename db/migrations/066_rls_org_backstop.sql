-- 066: Database-level RLS org-isolation backstop (SEC-1 / DB-1).
--
-- Intent:
--   Tenancy isolation today is app-layer ONLY (getOrgContext + readableClause).
--   A single missed WHERE clause = cross-org exposure, and the DB does not stop
--   it because the app connects as a superuser (RLS bypassed) and the legacy
--   EdgeQuake RLS uses a `tenant_id IS NULL` escape that is always true for web
--   rows. This migration adds a real DB backstop: a non-superuser application
--   role + FORCE RLS policies that scope every org-owned table to the org id
--   carried in the `app.current_org_id` GUC.
--
--   Coarse by design: this is a defense-in-depth BACKSTOP against cross-ORG
--   leaks. Intra-org sharing (per-user / per-team grants, privacy_level) stays
--   in the app layer (readableClause). The backstop only guarantees you can
--   never read another organization's rows even if an app filter is missed.
--
-- SAFETY — this migration is INERT until an operational cutover:
--   * The app currently connects as a superuser, which BYPASSES RLS entirely
--     (even with FORCE). So enabling RLS here changes nothing for the running
--     app — no outage risk on apply.
--   * Activation is a SEPARATE, staged ops step (see bottom). Do NOT switch the
--     app to `sayknowmind_app` until every query path runs inside
--     `withOrgRls()` (lib/db.ts), or queries will fail closed (0 rows).
--
-- Verified: the role+policy mechanism was proven on live data — a non-superuser
--   with no GUC sees 0 rows (fail-closed); with app.current_org_id set it sees
--   exactly that org's rows; a superuser still sees all.
--
-- Idempotency: guarded role creation + IF NOT EXISTS policies; safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Non-superuser application role (no LOGIN yet — ops sets a password at
--    cutover with: ALTER ROLE sayknowmind_app WITH LOGIN PASSWORD '...').
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sayknowmind_app') THEN
    CREATE ROLE sayknowmind_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sayknowmind_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sayknowmind_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sayknowmind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sayknowmind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sayknowmind_app;

-- ---------------------------------------------------------------------------
-- 2. FORCE RLS + org-isolation policy on every org-owned web data-plane table.
--    current_setting(..., true) returns NULL when the GUC is unset -> the
--    predicate is false -> 0 rows (fail-closed).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  org_tables TEXT[] := ARRAY[
    'documents', 'categories', 'entities', 'ingestion_jobs',
    'resource_shares', 'resource_team_shares', 'shared_content', 'tags'
  ];
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
    -- Only touch tables that actually exist and carry organization_id.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = 'org_isolation'
      ) THEN
        EXECUTE format(
          'CREATE POLICY org_isolation ON public.%I '
          || 'USING (organization_id::text = current_setting(''app.current_org_id'', true)) '
          || 'WITH CHECK (organization_id::text = current_setting(''app.current_org_id'', true))',
          t
        );
      END IF;
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- OPERATIONAL CUTOVER (do NOT do this as part of applying the migration):
--   1. Route every web query through lib/db.ts `withOrgRls(orgId, ...)` so each
--      request sets `app.current_org_id` inside a transaction (SET LOCAL).
--   2. On staging: ALTER ROLE sayknowmind_app WITH LOGIN PASSWORD '<strong>';
--      point DATABASE_URL at sayknowmind_app and smoke-test EVERY route returns
--      the correct rows (and that cross-org access returns nothing).
--   3. Only then switch production DATABASE_URL to sayknowmind_app.
--   Until step 3, the app stays on the superuser connection and these policies
--   are inert (no behavior change).
-- ---------------------------------------------------------------------------
