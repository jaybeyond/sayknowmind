#!/usr/bin/env bash
# SayKnowMind — Database Migration Runner
# Usage: ./migrate.sh [DATABASE_URL]
#
# Runs all SQL migrations in order. Tracks applied migrations
# in a `schema_migrations` table to avoid re-running.

set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"

if [ -z "$DB_URL" ]; then
  echo "Usage: $0 <DATABASE_URL>"
  echo "  or set DATABASE_URL environment variable"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Create tracking table if not exists
psql "$DB_URL" -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

# Rename old filenames in schema_migrations to match new numbering
# This handles databases that ran migrations before the renumber
declare -A RENAMES=(
  ["001-shared-content-add-columns.sql"]="026_shared_content_add_columns.sql"
  ["002-telegram-links.sql"]="027_telegram_links.sql"
  ["003-channel-links.sql"]="028_channel_links.sql"
  ["026_add_bot_token_to_channel_links.sql"]="029_add_bot_token_to_channel_links.sql"
  ["027_add_lang_to_channel_links.sql"]="030_add_lang_to_channel_links.sql"
  ["027_conversations_simple.sql"]="031_conversations_simple.sql"
  ["027_document_relations.sql"]="032_document_relations.sql"
  ["028_categories_unique_index.sql"]="033_categories_unique_index.sql"
  ["028_notifications.sql"]="034_notifications.sql"
  ["026-admin-role.sql"]="035_admin_role.sql"
)

for old_name in "${!RENAMES[@]}"; do
  new_name="${RENAMES[$old_name]}"
  psql "$DB_URL" -q -c "UPDATE schema_migrations SET filename = '$new_name' WHERE filename = '$old_name'" 2>/dev/null || true
done

# Run each migration in order
applied=0
skipped=0

for f in "$SCRIPT_DIR"/*.sql; do
  filename="$(basename "$f")"

  # Check if already applied
  already=$(psql "$DB_URL" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$filename'" 2>/dev/null || echo "")

  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "Applying: $filename"
  psql "$DB_URL" -f "$f"

  psql "$DB_URL" -q -c "INSERT INTO schema_migrations (filename) VALUES ('$filename')"
  applied=$((applied + 1))
done

echo ""
echo "Done. Applied: $applied, Skipped: $skipped"
