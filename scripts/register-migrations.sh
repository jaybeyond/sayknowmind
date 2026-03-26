#!/bin/bash
# Register EdgeQuake migrations in _sqlx_migrations table
# This marks all migrations as "already applied" since we ran them manually

DB_URL="${1:-postgresql://postgres@localhost:5433/sayknowmind}"

for f in packages/edgequake/migrations/*.sql; do
  basename=$(basename "$f")
  ver=$(echo "$basename" | grep -o '^[0-9]*' | sed 's/^0*//')
  desc=$(echo "$basename" | sed 's/\.sql$//')
  checksum_hex=$(shasum -a 256 "$f" | awk '{print $1}')

  psql "$DB_URL" -q -c "
    INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time)
    VALUES ($ver, '$desc', NOW(), true, decode('$checksum_hex', 'hex'), 100)
    ON CONFLICT (version) DO NOTHING;
  " 2>&1

  echo "Registered: $ver - $desc"
done

echo "Done. Total migrations:"
psql "$DB_URL" -c "SELECT count(*) FROM _sqlx_migrations"
