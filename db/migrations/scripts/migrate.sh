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
