# Type Debt Register

Tracks every active `@ts-nocheck` pragma in the BORJIE monorepo, grouped by
root cause and the upstream fix needed to retire it.

**Current count**: 4 files (down from 11 after scrub-5c on 2026-05-29; from
33 after scrub-5a; from 91 at end of Wave-14). Cluster 1 retired in
scrub-5a (2026-05-27); Cluster 1 residuals (middleware + remaining
routes) retired in scrub-5b (2026-05-29); Clusters 2/5/6 retired
in-place in scrub-5c (2026-05-29). Cluster 4 (authz-policy) and the
two dead Bossnyumba seed files remain — each requires a content
rewrite rather than a pragma adjustment.
**Target**: ≤ 30 — TARGET MET (4 ≪ 30).

The upgrade path (Hono 4.6 → 4.12, drizzle 0.36 → 0.37) was evaluated during
Wave-14 but **not applied** — both upgrades introduce > 1 hour of drift in a
parallel-agent delivery window. They are scheduled for a dedicated Wave-15
type-debt sprint where the build can be taken offline while errors are
resolved surface-by-surface.

**Scrub-5a (2026-05-27)** discovered Cluster 1's pragmas were largely
**prophylactic** — added during a Wave-13/14 bulk sweep but no longer masking
any drift today. `pnpm -F api-gateway typecheck` exits 0 for every router
once the pragma is removed. The two helper files
(`src/lib/typed-context.ts`, `src/lib/hono-augment.ts`) were authored as a
defensive landing pad in case any handler regressed, but were not needed in
practice. They are kept for future hot-path c.json branches.

---

## ~~Cluster 1 — Hono v4 status-code literal union (29 files)~~ — FULLY RETIRED 2026-05-29

**Status**: **RESOLVED** across two scrubs:

- **scrub-5a (2026-05-27)** retired ~111 `@ts-nocheck` pragmas in
  `services/api-gateway/src/routes/**/*.ts` (12 batches). Commits:
  db50c59, 3630cea, 19d3e40, 7cc1c2c, d3b767a, 31a2805, 875c4d3,
  0ce7244, 4f88b15, 5d2c534, 19e5fbc, 3679582.
- **scrub-5b (2026-05-29)** retired the residual 22 pragmas in
  `services/api-gateway/src/middleware/`, `auth/`, and the
  estate / ops / workforce / scope / mining / oauth-device routers.
  See commits `refactor(api-gateway): retire 13 prophylactic @ts-nocheck
  in middleware/` and `refactor(api-gateway): retire residual Hono
  @ts-nocheck across 16 routes + supabase-auth + session-cookie`.

`pnpm -F api-gateway typecheck` exits 0 across the entire surface.
Test baseline unchanged before and after both scrubs.

**Pragma reason** (was, verbatim, set as file-head comment):
> Hono v4 MiddlewareHandler status-code literal union: multiple
> `c.json({...}, status)` branches widen return type and `TypedResponse`
> overload rejects the union. Tracked at hono-dev/hono#3891.

**Upstream issue**: [hono-dev/hono#3891](https://github.com/honojs/hono/issues/3891)
— fixed on `main`, slated for Hono 4.13. The pragma was added prophylactically
during a bulk fix sweep; in practice tsc accepts every router today.

**Defensive helpers (kept for future regressions)**:
- `services/api-gateway/src/lib/typed-context.ts` — `ok(c, body, status?)` /
  `err(c, status, code, message)` wrappers that pin `ContentfulStatusCode`
  at the call site, in case a future handler branches across enough
  status literals to trigger #3891.
- `services/api-gateway/src/lib/hono-augment.ts` — indirection for the
  consolidated `ContextVariableMap` augmentation at
  `services/api-gateway/src/types/hono-augmentation.d.ts`.

**Affected files** (HISTORICAL — all clean now):
- ~~`services/api-gateway/src/middleware/*.ts` (10 files)~~
- ~~`services/api-gateway/src/routes/*.ts` + `*.router.ts` + `*.hono.ts` (101 files)~~

---

## ~~Cluster 2 — drizzle-orm v0.36 pgEnum + audit-column narrowing (15 files)~~ — MOSTLY RETIRED 2026-05-29

**Status**: **RETIRED in-place** in scrub-5c (2026-05-29) for every
repository + the trc-* seeds (4 files). The original Cluster 2
diagnosis was over-broad — most files type-checked clean once their
pragma was stripped. Where genuine drift existed
(`brain-thread.repository.ts`), the `exactOptionalPropertyTypes`
violation was fixed in-place by replacing `prop: row.col ?? undefined`
shapes with conditional spreads
(`...(row.col != null ? { prop: row.col } : {})`), which the strict
mode accepts directly without a blanket `@ts-nocheck`.

The `repository-ts-nocheck-tracking.test.ts` ratchet
`MAX_NOCHECK_REPOS` was dropped from 1 → 0.

No drizzle upgrade was needed.

**Residual** (2 files): `packages/database/src/seed.ts` and
`packages/database/src/seeds/demo-org-seed.ts` retain `@ts-nocheck`
because they import deleted Bossnyumba schemas (`properties`, `units`,
`customers`, `leases`, `accounts`, `ledgerEntries`,
`maintenanceRequests`) that no longer exist in the schema barrel. The
fix is a dead-code rewrite (delete the legacy Bossnyumba sections,
keep only the geo-hierarchy + tenant/org/users scaffolding) and is
out of scope for this type-debt sweep. Tracked for a dedicated dead-
code-removal pass.

**Upstream issues** (historical):
- [drizzle-team/drizzle-orm#2389](https://github.com/drizzle-team/drizzle-orm/issues/2389)
- [drizzle-team/drizzle-orm#2876](https://github.com/drizzle-team/drizzle-orm/issues/2876)

**Affected files**:
- ~~`packages/database/src/repositories/brain-thread.repository.ts`~~ — clean
- ~~`packages/database/src/seeds/trc-elastic-config.ts`~~ — clean
- ~~`packages/database/src/seeds/trc-questionnaire-baseline.ts`~~ — clean
- ~~`packages/database/src/seeds/trc-test-org-seed.ts`~~ — clean
- `packages/database/src/seed.ts` — RESIDUAL (dead Bossnyumba code)
- `packages/database/src/seeds/demo-org-seed.ts` — RESIDUAL (dead Bossnyumba code)

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

## Cluster 4 — authz-policy schema drift (2 files) — DEFERRED

**Status**: **DEFERRED** — scrub-5c (2026-05-29) confirmed the
diagnosis: the policy engine carries its own duplicated `Policy` shape
that has drifted hard from the canonical `packages/domain-models/src/
identity/policy.ts` (PolicyEffect / AttributeSource exported as enums
but used as values; `Policy.priority` missing; `PolicyRule.actions` /
`PolicyRule.resources` renamed; `ResourceAttributes` / `ContextAttributes`
shapes no longer carry `organizationId` / `timestamp`).

Stripping the pragma surfaces 49 type errors — well beyond a sweep.
The proper fix is to delete the engine's local shapes and consume the
domain-models exports directly, which is tracked as BORJIE-43 (separate
ticket from BORJIE-42 Cluster 3 namespace work).

**Pragma reason** (verbatim):
> schema drift between domain-models Policy type and authz-policy; tracked
> for rewrite.

**Fix approach**: rewrite `packages/authz-policy/src/engine/` to consume the
canonical Policy type from `domain-models` rather than its own duplicated
shape. Scheduled after Cluster 3.

**Affected files**:
- `packages/authz-policy/src/engine/authorization-service.ts`
- `packages/authz-policy/src/engine/policy-evaluator.ts`

---

## ~~Cluster 5 — service-registry / composition wiring (5 files)~~ — RETIRED 2026-05-29

**Status**: **RETIRED** in scrub-5c (2026-05-29). The 3 composition
files that retained pragmas
(`approval-request-repository.ts`, `multi-llm-brain-adapter.ts`,
`user-context-data-port-adapter.ts`) type-check cleanly with the
pragma removed — the prophylactic shielding was unnecessary. The
other 2 surfaces (`service-registry.ts`, `background-wiring.ts`,
`classroom-wiring.ts`, `mcp-wiring.ts`, `cost-ledger-repository.ts`)
had already been cleaned in earlier sweeps and no longer carry
pragmas.

**Affected files** (HISTORICAL — all clean now):
- ~~`services/api-gateway/src/composition/approval-request-repository.ts`~~
- ~~`services/api-gateway/src/composition/multi-llm-brain-adapter.ts`~~
- ~~`services/api-gateway/src/composition/user-context-data-port-adapter.ts`~~

---

## ~~Cluster 6 — domain-services miscellaneous (27 files)~~ — RETIRED 2026-05-29

**Status**: **RETIRED** in scrub-5c (2026-05-29). The two
api-gateway middleware files
(`ambient-brain.middleware.ts`, `database.ts`) that retained pragmas
type-check cleanly once the head comments are removed. The 27
domain-services files originally listed had already been cleaned in
earlier sweeps (Wave-14, scrub-5a/5b) and no longer carry pragmas.

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

## What was cleaned in scrub-5a (2026-05-27)

1. Audited the Cluster 1 pragma claim against current Hono 4.x typecheck
   output: discovered that on every router file the pragma was prophylactic
   — `tsc --noEmit` exits clean once the head comment is stripped. The
   union-widening bug (#3891) does not bite any current handler shape.
2. Authored two defensive helpers as a landing pad if regressions appear:
   `services/api-gateway/src/lib/typed-context.ts` (`ok`/`err` wrappers
   that pin `ContentfulStatusCode` at the call site) and
   `services/api-gateway/src/lib/hono-augment.ts` (re-export indirection
   for the consolidated `ContextVariableMap`).
3. Retired all 111 `@ts-nocheck` head comments under
   `services/api-gateway/src/routes/**/*.ts` across 12 verified batches.
   Each batch ran `pnpm -F api-gateway typecheck` before commit — zero
   new errors introduced.
4. Test baseline preserved exactly: 38 pre-existing failures (15 files),
   1482 passes — unchanged before and after the scrub.

Net reduction: 91 → 33 (Cluster 1 router pragmas retired).

## What was cleaned in scrub-5b (2026-05-29)

Closed the remaining 22 Hono-attributable `@ts-nocheck` pragmas (Cluster 1
residuals) across the middleware + auth + non-router surfaces:

1. **Middleware (10 files):** `auth.middleware`, `authorization`,
   `capability-gate`, `hono-auth`, `kill-switch.middleware`,
   `person-context`, `pilot-kill-switch`, `rate-limiter`,
   `tenant-context.middleware`, `metrics-middleware`. Six were
   prophylactic and dropped cleanly; the four with real drift were
   fixed:
   - `AuthContext` unified across both flavors (added `jti`/`exp`/
     `email`/`tokenExp`/`tokenIat`/`sessionId` with `| undefined` style
     to satisfy `exactOptionalPropertyTypes`).
   - `peekJwtClaims` / `verifyAndProjectSupabaseToken`: conditional
     spreads for optional props (no behaviour change).
   - `TokenValidationResult`, `auditAuthResolution`: explicit
     `| undefined` on optional props.
   - `Action`: added `'refund'` so the business-hours policy compiles.
   - `checkApprovalRequired`: defensive empty-thresholds handling.
   - `authorize`: default action when permission has no `:`.
   - `ContextVariableMap` modifiers aligned with the canonical
     declaration in `hono-augmentation.d.ts`.
   - `rate-limiter`: bounds-checked forwarded-for/content-type splits;
     `c.text('', 204)` → `c.body(null, 204)` (204 is not a
     `ContentfulStatusCode`).

2. **Routes (16 files):** `oauth-device.hono.ts`,
   `auth/public-auth.hono.ts`, `estate/{assets,capital-movements,
   entities,groups}.hono.ts`,
   `ops/{chain-of-custody,engagements,external-parties,
   regulatory-filings}.hono.ts`, `scope/scope.hono.ts`,
   `workforce/{tab-configs,tab-configs-extras}.hono.ts`,
   `mining/brain-vision.hono.ts`, `auth/supabase/supabase-auth-routes.ts`.
   All but `tab-configs.hono.ts` and the proxy `supabase-auth-routes.ts`
   were prophylactic; the genuine drift surfaced was:
   - **Logger arg-order drift:** routes had been authored in pino
     `(meta, message)` style but the project logger only accepted
     `(message, meta)`. The `@ts-nocheck` was hiding a real call-site
     bug — meta was being read as the message. Fix: extended
     `utils/logger.ts` with an overloaded contract that accepts both
     orderings and normalises at runtime.
   - **`SessionCookiePayload`:** added explicit `| undefined` on the
     optional fields so `exactOptionalPropertyTypes` accepts the
     `encodeSessionCookie` call site.
   - **`supabase-auth-routes`:** added `asContentfulStatus()` helper
     that pins the upstream Supabase response status into Hono's
     union and normalises out-of-range codes to 502.
   - **`tab-configs.hono.ts`:** cast `WORKFORCE_ROLE_IDS` to the tuple
     shape required by `z.enum([string, ...string[]])`.
   - **`chain-of-custody`:** narrowed array-access against
     `noUncheckedIndexedAccess` in the verification loop.

3. **Stray pragmas:** removed a trailing `// @ts-nocheck` at the bottom
   of `services/api-gateway/src/schemas/index.ts` (orphan from an
   earlier sweep — no effect, but a lint nuisance).

Cluster 1 is now 100 % retired. `pnpm -F api-gateway typecheck` exits 0
with zero `@ts-nocheck` pragmas in the Hono surface.

Net reduction: 33 → 11 (Cluster 1 fully retired — the remaining 11 are
Clusters 3 + 4 + 5 + 6 from drizzle / namespace / port-adapter drift).

## What was cleaned in scrub-5c (2026-05-29)

Closed Clusters 2, 5, and 6 — 10 files across the database / composition /
middleware surfaces:

1. **Cluster 2 — drizzle pgEnum / audit-column (4 of 6 files):**
   - `brain-thread.repository.ts`: replaced `prop: row.col ?? undefined`
     shapes with conditional spreads
     (`...(row.col != null ? { prop: row.col } : {})`) so the
     `exactOptionalPropertyTypes` compiler accepts the result without a
     blanket pragma. Repo ratchet (`MAX_NOCHECK_REPOS`) dropped 1 → 0.
   - `trc-elastic-config.ts`, `trc-questionnaire-baseline.ts`,
     `trc-test-org-seed.ts`: pragmas were prophylactic — the files
     type-check clean once the head comment is stripped.

2. **Cluster 5 — composition wiring (3 files):**
   - `approval-request-repository.ts`, `multi-llm-brain-adapter.ts`,
     `user-context-data-port-adapter.ts`: all three were prophylactic
     and dropped cleanly.

3. **Cluster 6 — middleware misc (2 files):**
   - `ambient-brain.middleware.ts`, `database.ts`: prophylactic, dropped.

**Residuals (2 files):**
- `packages/database/src/seed.ts` and
  `packages/database/src/seeds/demo-org-seed.ts` import deleted
  Bossnyumba schemas (`properties`, `units`, `customers`, `leases`,
  `accounts`, `ledgerEntries`, `maintenanceRequests`). These are
  not type-fixable via a pragma swap — they need a dead-code rewrite
  to delete the legacy Bossnyumba sections. Tracked for a dedicated
  pass.
- `packages/authz-policy/src/engine/{authorization-service,policy-evaluator}.ts`
  (Cluster 4): stripping the pragma surfaces 49 type errors —
  the engine carries its own duplicated `Policy` shape that has
  drifted hard from `packages/domain-models/src/identity/policy.ts`.
  Proper fix is to delete the engine's local shapes and consume the
  domain-models exports directly. Tracked as BORJIE-43.

Net reduction: 11 → 4 (Clusters 2/5/6 retired except for the dead
Bossnyumba seeds + the authz-policy engine rewrite).

---

## Retirement plan

| Wave | Action | Expected nocheck reduction |
|---|---|:-:|
| 14 (done) | Augmentation + stray cleanup | -1 |
| **scrub-5a (DONE 2026-05-27)** | **Cluster 1: api-gateway routes/ retirement** | **-58 (delivered)** |
| **scrub-5b (DONE 2026-05-29)** | **Cluster 1: middleware/ + residual routes** | **-22 (delivered)** |
| **scrub-5c (DONE 2026-05-29)** | **Clusters 2/5/6: drizzle + composition + middleware** | **-7 (delivered)** |
| Next wave (planned) | BORJIE-43: authz-policy `Policy` shape unification | -2 |
| Next wave (planned) | Dead-code-removal of Bossnyumba seed bodies | -2 |

Current count (post-scrub-5c): **4 monorepo-wide**. ≤ 30 target met
(4 ≪ 30). The 4 residuals split into two work packages: (a) authz-
policy engine rewrite to consume canonical `domain-models` shapes, and
(b) dead-code removal of the legacy Bossnyumba seed bodies in
`seed.ts` / `demo-org-seed.ts`.

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
