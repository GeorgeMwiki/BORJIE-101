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
