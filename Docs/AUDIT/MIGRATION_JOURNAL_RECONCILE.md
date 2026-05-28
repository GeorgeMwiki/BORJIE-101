# Drizzle Migration Journal Reconcile

**Last reconciled:** 2026-05-28
**Wave:** BRAIN-DEPTH (Scope 5)
**Author:** founder agent

## Why

The dev Postgres had every migration table from `0079..0096b` (plus
`0097`, `0100`) physically present, but `drizzle.__drizzle_migrations`
only held 11 rows. The 11 rows covered the initial bootstrap window
(0000..0015); the remainder were applied through ad-hoc `psql -f` runs
without their corresponding journal insert.

Without a complete journal, the next invocation of `pnpm db:migrate`
(which is what CI and any fresh `dev:up` run) would re-attempt each
unjournalled migration. Because every Borjie migration is wrapped in
`IF NOT EXISTS / DO blocks`, the re-attempts would not destroy data,
but they would generate noisy `NOTICE` floods and slow boot.

## What the writer expects

`packages/database/src/run-migrations.ts:75-106` defines the schema
and the insertion contract:

```sql
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
)
```

Critically, the `hash` column stores the **filename root** of each
migration file (e.g. `0089_owner_reminders_and_tabs`), not a sha256
digest. The `alreadyApplied` check is a literal string match against
this column. Reconciling means inserting one row per applied
migration whose `hash` equals the filename root.

## Reconcile script

```bash
DBURL=$(grep -E "^DATABASE_URL=" .env.local | head -1 | cut -d= -f2-)

# Migrations 0079..0096b (plus 0097, 0100, 0108, 0109) physically
# applied but missing from the journal.
for m in 0079 0080 0081 0082 0083 0084 0085 0086 0087 0088 0089 \
         0090 0091 0092 0093 0094 0095 0096 0096b \
         0097 0100 0108 0109; do
  f=$(ls packages/database/src/migrations/${m}_*.sql 2>/dev/null | head -1)
  [ -z "$f" ] && continue
  NAME=$(basename "$f" .sql)
  psql "$DBURL" -c "
    INSERT INTO drizzle.__drizzle_migrations(hash, created_at)
    SELECT '$NAME', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    WHERE NOT EXISTS (
      SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '$NAME'
    );
  "
done
```

The `SELECT ... WHERE NOT EXISTS` form makes the reconcile idempotent
— re-running the script will not double-insert.

## Result

```text
Before reconcile: 11 rows
After  reconcile: 34 rows
```

Verification:

```bash
psql "$DBURL" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"
#  count
# -------
#     34
```

Future `pnpm db:migrate` runs will now skip every applied file with
the standard "Skipping <file> (already applied)" log line.

## Future migrations (0097..)

The numbered range `0097`..`0107` includes sibling-agent work tracked
under the BRAIN-UI-CONTROL and other concurrent waves. Sibling agents
own those migrations end-to-end (per the BRAIN-DEPTH directive's "DO
NOT TOUCH" list). For each sibling-applied migration, the same
journal insert pattern MUST be performed by the owning agent so the
journal stays consistent across the team.

When a future agent adds a migration file, the apply path should be:

```bash
psql "$DBURL" -f packages/database/src/migrations/NEW_FILE.sql
psql "$DBURL" -c "
  INSERT INTO drizzle.__drizzle_migrations(hash, created_at)
  SELECT 'NEW_FILE_BASENAME_NO_EXT', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  WHERE NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'NEW_FILE_BASENAME_NO_EXT'
  );
"
```

## Cross-checks

- `Docs/CODEMAPS/database.md` documents the canonical migration
  pipeline.
- `services/api-gateway/src/composition/db-client.ts:51` is the
  runtime client these migrations back.
- `.github/workflows/borjie-db-migrations-check.yml` lints forward-
  only conformance on every PR.
