-- Tasks: add work_items.start_date so a task has an editable scheduled START,
-- independent of created_at (which is an immutable record fact). The timeline
-- (Gantt) needs this to move a bar as a whole and to resize its left edge —
-- with only created_at + due_date you can only ever change the right edge.
--
-- Nullable: a task with no start_date falls back to created_at for placement.
-- Idempotent.
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS start_date timestamptz;
