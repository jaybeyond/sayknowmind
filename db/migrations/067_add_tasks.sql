-- Task management (Linear-style issue tracker), adapted from the circle
-- template (ln-dev7/circle, MIT) onto our Postgres + org/visibility model.
--
-- NB: the table is `work_items`, NOT `tasks` — a `tasks` table already exists
-- (the EdgeQuake background-job processor, keyed by tenant_id/workspace_id; see
-- the two-data-models hazard). This user-facing feature is deliberately named
-- distinctly at the DB layer while surfacing as "Tasks" in the UI.
--
-- A work item is an org-scoped, collaborative unit of work: it belongs to one
-- organization (the team space) and is created by a user. Unlike documents,
-- work items default to team-visible (`shared`) because project tracking is
-- inherently collaborative. Status and priority are fixed enums stored on the
-- row (matching the template's fixed sets); labels are inlined as JSONB to
-- avoid a join table at this stage. `rank` is a LexoRank-style string for
-- stable manual ordering within a status column. `document_id` optionally links
-- a work item to a memory — the "knowledge → action" bridge a plain tracker
-- lacks.
CREATE TABLE IF NOT EXISTS work_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id text,
  privacy_level   text NOT NULL DEFAULT 'shared',
  -- Human-friendly per-org sequential id (e.g. TASK-101), assigned in the API.
  identifier      text,
  title           text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'backlog',
  priority        text NOT NULL DEFAULT 'no-priority',
  -- Assignee is a team member; nullable (unassigned). SET NULL on user delete
  -- so the item survives the assignee leaving.
  assignee_id     text REFERENCES "user"(id) ON DELETE SET NULL,
  labels          jsonb NOT NULL DEFAULT '[]'::jsonb,
  rank            text,
  due_date        date,
  document_id     uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- Board/list queries scope by org then group by status and order by rank.
CREATE INDEX IF NOT EXISTS idx_work_items_org_status ON work_items (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_work_items_user        ON work_items (user_id);
CREATE INDEX IF NOT EXISTS idx_work_items_assignee    ON work_items (assignee_id);
CREATE INDEX IF NOT EXISTS idx_work_items_document    ON work_items (document_id);

-- Per-org monotonic counter backing the TASK-NNN identifier, so numbers don't
-- collide or reuse under concurrency (the API bumps this in the same tx as the
-- insert). Keyed by org; a NULL-org (personal) work item uses the '_personal'
-- key since a text PK can't be NULL.
CREATE TABLE IF NOT EXISTS work_item_counters (
  organization_id text PRIMARY KEY,
  last_number     integer NOT NULL DEFAULT 0
);
