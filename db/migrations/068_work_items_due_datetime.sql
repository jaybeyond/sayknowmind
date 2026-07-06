-- Tasks: promote work_items.due_date from DATE to TIMESTAMPTZ so a task can
-- carry a due *time*, not just a day. The board/calendar/timeline views need a
-- real instant to place a task at (e.g. "due today 15:00"). Existing DATE values
-- become midnight in the server tz — no data loss.
--
-- Idempotent: only alters when the column is still a plain date.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_items' AND column_name = 'due_date' AND data_type = 'date'
  ) THEN
    ALTER TABLE work_items
      ALTER COLUMN due_date TYPE timestamptz USING due_date::timestamptz;
  END IF;
END
$$;
