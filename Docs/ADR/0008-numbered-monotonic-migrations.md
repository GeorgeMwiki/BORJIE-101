# ADR 0008 — Numbered monotonic migrations

- **Status:** Accepted
- **Date:** 2026-03 (post Wave-3 Z1 + MIG-FIX)

## Context

Drizzle ships timestamp-keyed migrations by default. With multiple
engineers landing schema changes from feature branches in parallel,
we hit a collision (Wave-3 Z1) where two migrations claimed the
same timestamp and the migrator silently picked one. The cost was
a ~12-hour gap where two environments had divergent schemas.

Options considered:

| Option | Verdict |
|---|---|
| Timestamp-keyed (Drizzle default) | Collisions on parallel work; merge-time races |
| Hash-keyed | No human-readable ordering; review pain |
| Numbered + monotonic (NNNN_name.sql) | Selected |
| Numbered + non-monotonic | Branch merges can interleave gaps |

## Decision

Migrations live in `packages/database/src/migrations/NNNN_name.sql`
with a strict 4-digit prefix incrementing monotonically. The
pre-commit hook rejects gaps and duplicates. CI runs the full set
against a fresh DB (Z-MIG verification) before merge. As of
2026-05, the platform is at 184 applied migrations.

## Consequences

**Positive:**

- Trivial human-readable ordering at review time.
- Pre-commit + CI catch collisions before main.
- The NOT-NULL backfill pre-deploy validator (Z8) gates breaking
  changes.
- Fresh-DB apply is part of CI — known regression-fixed.

**Negative:**

- Merge friction when two PRs both add NNNN+1; second PR must
  renumber.
- A long-lived branch must rebase its migration numbers regularly.
- No back-fill of a missed number — gaps stay (but a renumber
  utility exists).

## Alternatives considered

Hash-keyed approach lost on review readability. We may revisit
once schema work slows and human review of migrations is rare.

## References

- `packages/database/src/migrations/`
- Pre-commit hook in `package.json` root
- Z-MIG / MIG-FIX task set
- `Docs/ARCHITECTURE.md` § Migration discipline
