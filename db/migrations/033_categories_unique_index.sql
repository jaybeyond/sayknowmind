-- Migration: 033_categories_unique_index.sql
-- Add unique constraint on (user_id, name, parent_id) for ON CONFLICT in category auto-assignment

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_parent
ON categories (user_id, name, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'));
