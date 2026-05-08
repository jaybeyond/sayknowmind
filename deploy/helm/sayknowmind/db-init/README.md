# Postgres init scripts (synced from `/db/init/`)

These files are **mirrored** from the repository root `db/init/` directory.
The chart cannot reach files outside its own root via `.Files.Glob`, so a
copy lives here for `helm install`/`helm package` to be self-contained.

## When to re-sync

Whenever `/db/init/` changes:

```sh
make helm-sync-db-init
```

(This is wired up in the project root `Makefile`.)

The PostgreSQL `docker-entrypoint.sh` runs every `*.sql`, `*.sql.gz`, and
`*.sh` here in alphabetical order on **first DB initialization only**. To
re-run them you must drop the PVC (`db_data`).
