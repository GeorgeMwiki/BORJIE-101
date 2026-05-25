# Type Debt Register

Tracks every active `@ts-nocheck` pragma in the BORJIE monorepo, grouped by
root cause and the upstream fix needed to retire it.

**Current count**: 91 files (down from 92 at start of Wave-14 hardening).
**Target**: ≤ 30 after upstream upgrades unblock.

The upgrade path (Hono 4.6 → 4.12, drizzle 0.36 → 0.37) was evaluated during
Wave-14 but **not applied** — both upgrades introduce > 1 hour of drift in a
parallel-agent delivery window. They are scheduled for a dedicated Wave-15
type-debt sprint where the build can be taken offline while errors are
resolved surface-by-surface.

---

## Cluster 1 — Hono v4 status-code literal union (29 files)

**Pragma reason** (verbatim, set as file-head comment):
> Hono v4 MiddlewareHandler status-code literal union: multiple
> `c.json({...}, status)` branches widen return type and `TypedResponse`
> overload rejects the union. Tracked at hono-dev/hono#3891.

**Upstream issue**: [hono-dev/hono#3891](https://github.com/honojs/hono/issues/3891)
— fixed on `main`, slated for Hono 4.13. A 4.12 bump partially mitigates but
does not fully remove the union-narrowing failure for handlers that return
from several `c.json({...}, 4xx)` branches.

**Fix approach** (once 4.13 lands):
1. `pnpm -C services/api-gateway up hono@^4.13`
2. For each router, remove the `@ts-nocheck` head comment.
3. Run `pnpm -C services/api-gateway typecheck`.
4. Any residual handler: narrow the return type with an explicit union
   (`Response | TypedResponse<...>`) at the handler signature.

**Affected files**:
- `services/api-gateway/src/middleware/*.ts` (10 files)
- `services/api-gateway/src/routes/*.ts` + `*.router.ts` + `*.hono.ts` (19 files)

---

## Cluster 2 — drizzle-orm v0.36 pgEnum + audit-column narrowing (15 files)

**Pragma reason** (verbatim):
> drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in
> `eq()`; repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389
> (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
>
> drizzle-orm v0.36 audit-column narrowing: downstream apps use stricter
> `exactOptionalPropertyTypes` that rejects our insert/update shapes. Tracked:
> drizzle-team/drizzle-orm#2876.

**Upstream issues**:
- [drizzle-team/drizzle-orm#2389](https://github.com/drizzle-team/drizzle-orm/issues/2389)
- [drizzle-team/drizzle-orm#2876](https://github.com/drizzle-team/drizzle-orm/issues/2876)

**Fix approach**:
1. Upgrade drizzle-orm + drizzle-kit to 0.37.x in all three packages
   (`packages/database`, `services/domain-services`, `services/identity`).
2. Regenerate migrations if schema-dsl output changes
   (`pnpm drizzle-kit generate:pg`).
3. For pgEnum columns used in `eq()`: cast string → enum via
   `as typeof table.columnName.$type` rather than blanket `@ts-nocheck`.
4. For audit-column insert/update shapes: add explicit `Partial<InsertModel>`
   helpers in the repository layer.

**Affected files**:
- `packages/database/src/repositories/*.repository.ts` (13 files)
- `packages/database/src/seed.ts`
- `packages/database/src/seeds/demo-org-seed.ts`

---

## Cluster 3 — domain-models namespace/type drift (13 files)

**Pragma reason** (verbatim):
> domain-models has `PaymentMethod` / `WorkOrder` exported as namespaces not
> types + missing `Priority` / `Status` type exports. Rewrite pending
> domain-models namespace → type refactor. Tracked: BORJIE-42.

**Root cause**: `packages/domain-models/src/index.ts` historically exported
several entities as `namespace X { ... }` (so consumers imported the namespace
AND the embedded `Id` brand). Later consumers imported `X` as a type — which
now trips `TS2709: Cannot use namespace 'X' as a type`.

**Fix approach** (tracked as BORJIE-42):
1. In `packages/domain-models`, replace `export namespace WorkOrder { export const ... }` patterns with `export const WorkOrder = { ... } as const` + dedicated type exports.
2. Add missing `Priority` / `Status` / `AuditCategory` etc. type exports.
3. Consumers become `import type { WorkOrder } from '@borjie/domain-models'`.

**Affected files**:
- `packages/api-client/src/services/{work-orders,sla,payments}.ts` (3)
- `apps/customer-app/src/app/**/*.tsx` + `route.ts` (4)
- `apps/estate-manager-app/src/{app/api/brain/migrate/commit/route.ts,lib/brain-server.ts}` (2)
- `services/domain-services/src/{tenant/tenant-service,scheduling/*,invoice/index,maintenance/index,lease/index,property/index,customer/index,documents/document-service}.ts` (multiple; overlaps with cluster 2)

---

## Cluster 4 — authz-policy schema drift (2 files)

**Pragma reason**:
> schema drift between domain-models Policy type and authz-policy; tracked
> for rewrite.

**Fix approach**: rewrite `packages/authz-policy/src/engine/` to consume the
canonical Policy type from `domain-models` rather than its own duplicated
shape. Scheduled after Cluster 3.

**Affected files**:
- `packages/authz-policy/src/engine/authorization-service.ts`
- `packages/authz-policy/src/engine/policy-evaluator.ts`

---

## Cluster 5 — service-registry / composition wiring (5 files)

**Pragma reason**: combinations of clusters 1, 2, 3 — plus `DatabaseClient`
being exported as namespace vs type.

**Affected files**:
- `services/api-gateway/src/composition/{service-registry,background-wiring,classroom-wiring,mcp-wiring,cost-ledger-repository}.ts`

These unblock automatically once clusters 1–3 are fixed.

---

## Cluster 6 — domain-services miscellaneous (27 files)

Various intersections of Clusters 2 + 3. Each has a specific comment at file
head citing the exact drift point (WorkOrder namespace, TenantId brand,
PaginatedResult<T> rows→data rename, Money class, etc).

**Affected files**:
- `services/domain-services/src/approvals/{approval-repository.memory,approval-service}.ts`
- `services/domain-services/src/cases/postgres-case-repository.ts`
- `services/domain-services/src/compliance/gdpr-service.ts`
- `services/domain-services/src/iot/iot-service.ts`
- `services/domain-services/src/marketplace/postgres-marketplace-repository.ts`
- `services/domain-services/src/migration/postgres-migration-repository.ts`
- `services/domain-services/src/feature-flags/feature-flags-service.ts`
- `services/domain-services/src/maintenance-taxonomy/maintenance-taxonomy-service.ts`
- `services/domain-services/src/tenant/tenant-service.ts`
- `services/domain-services/src/scheduling/{types,scheduling-service,memory-repositories}.ts`
- `services/domain-services/src/index.ts`

---

## What was cleaned in Wave-14

1. Added consolidated Hono augmentation
   `services/api-gateway/src/types/hono-augmentation.d.ts` — declares every
   `c.set/c.get` key used across the gateway in a single place. This
   eliminates the per-file augmentation that several middleware files carried.
2. Refactored `services/api-gateway/src/schemas/index.ts` to split the
   `dateRangeSchema` base object from its `.refine()`-wrapped variant, so
   filter schemas can `.merge(dateRangeShape)` cleanly without a ZodEffects
   blocker.
3. Removed a stray trailing `// @ts-nocheck` in
   `services/api-gateway/src/routes/validators.ts`.

Net reduction: 92 → 91.

---

## Retirement plan

| Wave | Action | Expected nocheck reduction |
|---|---|:-:|
| 14 (this) | Augmentation + stray cleanup | -1 |
| 15 (planned) | Hono 4.13 upgrade + per-router type narrowing | -29 |
| 15 (planned) | drizzle 0.37 upgrade + enum/audit column fixes | -15 |
| 16 (planned) | BORJIE-42: domain-models namespace→type refactor | -13 |
| 16 (planned) | authz-policy Policy-type unification | -2 |
| 17 (planned) | service-registry + composition retype | -5 |
| 17 (planned) | domain-services residuals | -27 |

Final residual target after Wave 17: **0 pragmas**. Wave-15 alone should
drive the count below the ≤ 30 gate.

---

## Operating rules while pragmas remain

1. Every `@ts-nocheck` MUST have a single-line head comment citing:
   (a) the cluster number from this document, or
   (b) an upstream issue URL, and
   (c) a sentence describing the specific drift surface.
2. Never use blanket `any` — if a targeted fix is available, apply it.
3. New files are not permitted to introduce `@ts-nocheck` unless they block
   a hot-path delivery and a ticket is filed in the same PR.
4. Every release gate runs `scripts/count-nocheck.ts` (to be added in Wave-15)
   and fails if the count grows.
