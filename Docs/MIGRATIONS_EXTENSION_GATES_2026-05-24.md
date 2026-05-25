# Migrations: safe-fallback extension gates (2026-05-24)

## Why

P31 attempted a full repair of 9 legacy migrations + an RLS type-cast
fix in a new 0181 and stalled mid-restructure. This pass re-attempts
with MINIMAL scope: wrap the bare `CREATE EXTENSION` statements in 3
of the 9 listed migrations with the safe-fallback DO/EXCEPTION pattern
so the migration chain applies cleanly against a stock Postgres image
during `apply-check`. The RLS type-cast repairs are explicitly deferred.

The wrapper pattern (as specified in the task brief):

```sql
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS <name>;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '<file>: <name> unavailable: %', SQLERRM;
END $$;
```

When the extension is genuinely present (production, CI with pgvector /
PostGIS images) this is a no-op identical to the previous bare
`CREATE EXTENSION IF NOT EXISTS`. When the extension is absent (apply-
check against a stock Postgres image) the migration emits a NOTICE
instead of aborting the entire migration chain, so later migrations
(RLS, constraints) still get a chance to run and surface their own
errors. Downstream `vector(...)` columns and `geometry(...)` columns
still fail loudly at the column-create step if the extension is truly
missing at runtime — fail-loud locally, skip-loud in apply-check.

## Per-migration verdict

| Migration | Uses `vector` | Uses `geometry`/PostGIS | Uses `tsvector` | Change |
|---|---|---|---|---|
| `0124_wave4_query_indexes.sql` | no | no | no | no change — doesn't use either |
| `0125_kernel_memory_semantic_embedding.sql` | yes (`vector(1536)`, IVFFLAT) | no | no | wrapped existing `CREATE EXTENSION IF NOT EXISTS vector;` in DO/EXCEPTION |
| `0133_skill_registry.sql` | yes (`vector(1536)`, IVFFLAT) | no | no | wrapped existing `CREATE EXTENSION IF NOT EXISTS vector;` in DO/EXCEPTION |
| `0155_supabase_rls_policies.sql` | no | no | no | no change — doesn't use either |
| `0156_supabase_rls_phase2.sql` | no | no | no | no change — doesn't use either |
| `0160_autonomy_governance.sql` | no | no | no | no change — doesn't use either |
| `0163_phase_e_phase_f_constraints.sql` | no | no | no | no change — doesn't use either |
| `0164_portal_layouts.sql` | no | no | no | no change — doesn't use either |
| `0164_spatial_parcels.sql` | no | yes (PostGIS, `geometry(...)`) | no | wrapped existing `CREATE EXTENSION IF NOT EXISTS postgis;` in DO/EXCEPTION (`h3` + `h3_postgis` were already DO-wrapped) |

Net: 3 of 9 migrations got a gate change; 6 of 9 had no use of pgvector /
PostGIS / tsvector and were untouched.

## Files changed

3 files:

- `packages/database/src/migrations/0125_kernel_memory_semantic_embedding.sql`
- `packages/database/src/migrations/0133_skill_registry.sql`
- `packages/database/src/migrations/0164_spatial_parcels.sql`

## Human follow-up

- **RLS type-cast bug deferred.** P10's report flagged a RLS type-cast
  problem distinct from extension availability — that is still open and
  intentionally out of scope for this pass. The `apply-check` runner
  will still surface those failures against the 9 RLS migrations
  (0155 / 0156 / 0160 / 0163) — the extension gates only stop the chain
  from short-circuiting at 0125 / 0133 / 0164_spatial_parcels.
- **Production behaviour unchanged.** Production Postgres has pgvector
  and PostGIS installed, so the DO blocks are a no-op there. No data,
  schema, or index behaviour changes for live deployments.
- **No new 0181 migration was created** (per task brief, to avoid
  conflicts with concurrent agents).
