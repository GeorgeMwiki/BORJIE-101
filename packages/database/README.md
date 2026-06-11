# @borjie/database

Drizzle ORM schemas, migrations, and Postgres repositories for Borjie. All repos accept `orgId` and enforce tenant isolation at the query boundary.

## Usage

```ts
import { createRepos, getDb } from '@borjie/database'

const db = getDb(process.env.DATABASE_URL!)
const repos = createRepos(db)
const properties = await repos.properties.findMany({ orgId, limit: 20 })
```

Migrations live in `src/migrations/`. Run via `pnpm --filter @borjie/database migrate`.

### Backfill guidance (hardening M-2)

Large data-backfill migrations must not join on an **unindexed computed
expression**. Migration 0346 (`person_links → org_memberships`) joins on
`regexp_replace(persons.primary_phone_e164, '[^0-9]', '', 'g')`, which is
unindexable and forces a sequential scan — fine at current row counts, but a
hazard at scale. For any future person/identity backfill, **pre-compute a
stored, indexed normalized-phone column** (e.g. `persons.primary_phone_normalized`
with its own index) and join on that, or normalize inside a CTE before the
join, so the planner can use a hash / nested-loop join instead of a regex
scan. (0346 is shipped and immutable — this guidance is for the next one.)
