# DRIVE-TO-ZERO DEBT REGISTER — read-only marker/debt audit

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Lane:** `drive-to-zero-debt-audit`
**Author:** read-only marker sweep (grep/find + repo audit scripts) over `packages/`, `services/`, `apps/` (node_modules/dist/.next/build/coverage excluded).
**Mandate:** DRIVE-TO-ZERO — 0 TODOs, nothing deferred, no debt/bugs/unwired/missing-UI/missing-logic/incomplete-logic/skipped-tests/type-suppressions. This register is the SCOPE of that drive: every residual marker, counted, ranked, and given a one-line closure.
**Cross-ref:** complements `Docs/research/MASTER_GAP_REGISTER.md` (132 feature gaps). That register tracks *missing capability*; THIS register tracks *code-level debt markers* in shipped code. Where they overlap it is noted inline.

---

## TL;DR — the headline is "much cleaner than the raw grep"

The raw first-pass greps looked alarming (89 `@ts-expect-error`, 826 `: any`, 2179 stub/placeholder hits, 110 "skipped tests"). **Almost all of that is build-artifact noise or false positives** once `.next/`/`dist/` are excluded and prose is filtered:

| First-pass raw | After de-noising (real source) | Why the raw number was inflated |
|---|---|---|
| `@ts-expect-error` 89 / `@ts-ignore` 10 = 99 | **16** (and **6 of those are in tests, intentional**) | 190 raw counted `apps/*/.next/` compiled output |
| `: any` 826 | **114** (`as any` only; the rest were prose like "any DB error") | `:\s*any\b` matched English in comments |
| stub/placeholder 2179 | **~16 real unwired stubs** | matched `<input placeholder=…>`, the word "stub" in JSDoc, etc. |
| "skipped tests" 110 | **31 real** `it.skip`/`describe.skip` (0 `it.only`) | matched every `process.exit()` and `.skipIf()` env-gate |
| TODO/FIXME 36 | **1** real non-test TODO; rest are `R4 TODO` doc-comments in skip blocks | — |
| NOT_YET_WIRED 41 | **0 violations** per `audit-not-yet-wired.mjs` (allowlisted, typed pattern) | it is a *deliberate fail-closed design*, not debt |

**Net real debt surface:**
- **0** `it.only` / `fdescribe` (no hidden test suites). 
- **0** empty `catch {}` swallowed errors. 
- **1** real TODO in product source.
- **16** real `@ts-*` suppressions (10 in product code).
- **~16** unwired/no-op stub services (all logged, all honest-empty, all behind the property→mining rewrite).
- **31** skipped tests — **all** in `api-gateway`, **all** tagged `R4 TODO — vestigial property-domain`.
- **114** `as any` + **1085** `as unknown as` — the ONE genuinely large category, concentrated at the Drizzle ORM row-mapping boundary in `api-gateway` and `domain-services`.

The drive-to-zero is therefore **dominated by two clusters**, not a long tail:
1. **Type-suppression at the DB boundary** (`as unknown as` row casts) — 1085 sites, mechanical, design-needed (one typed `mapRow<T>` helper).
2. **Vestigial property-domain residue** (skipped tests + rewrite-pending stubs) — the property→mining migration tail. ~31 skips + ~16 stubs that are mutually dependent (the skips test the stubs).

---

## Counts by category (real source, de-noised)

| Kind | Count | Severity (worst) | Quick-win? |
|---|---:|---|---|
| `as unknown as` type-suppression | **1085** | MED | needs-design (one helper) then mechanical |
| `as any` type-suppression | **114** | MED | mostly quick-win |
| skipped tests (`it.skip`/`describe.skip`) | **31** | HIGH | needs-design (depends on stub rewrite) |
| unwired/no-op "rewrite pending" stubs | **~16** | HIGH | needs-design (mining-domain logic) |
| `@ts-expect-error`/`@ts-ignore` in product src | **10** | MED | quick-win |
| `@ts-expect-error` in tests (intentional) | **6** | LOW | leave as-is (negative-path coverage) |
| NOT_YET_WIRED typed placeholders (external integrations) | **~10 slots** | MED | needs-design (3rd-party env/creds: NIDA, e-Ardhi, KRA) |
| real TODO/FIXME in product src | **1** | LOW | quick-win |
| `R4 TODO` doc-comments (in skip blocks) | **~28** | LOW | resolved-by skip-cluster fix |
| empty `catch {}` (swallowed errors) | **0** | — | — |
| `it.only`/`fdescribe` (hidden suites) | **0** | — | — |
| HACK/XXX real markers | **0** | — | — |

> `eslint-disable` (443 raw) is **not counted as debt**: 318 are `no-explicit-any` paired with the `as any` already counted, 93 `no-console` (CLI/script files where stdout is the product), 56 `security/detect-non-literal-fs-filename` (audit scripts reading the repo tree). These are policy-acknowledged, not latent bugs. Spot-audit if desired but they are out of the zero-debt critical path.

---

## PRIORITIZED REGISTER

### BLOCKER — none

No BLOCKER-class code-debt markers found. (Feature-level BLOCKERs live in `MASTER_GAP_REGISTER.md`, not here — those are missing capability, not debt in shipped code.) No hidden tests, no swallowed errors, no money-path stubs.

---

### HIGH

#### H1 — Vestigial property-domain stub services return no-op / empty (incomplete-logic)
**Count:** ~6 services, ~10 stub methods. **Quick-win?** NO — needs mining-domain design.
These compile and are wired, but every call logs `… stub (mining-domain rewrite pending)` and returns empty/echoes input. Real data never persists. Worst offenders:
- `packages/database/src/services/market-rate-snapshots.service.ts:56` — `insert()` logs+echoes, `listRecent()` returns `[]`. Market-rate snapshots are never stored.
- `packages/database/src/services/tenant-predictions.service.ts:74,81` — `insertPrediction()` / `insertOpportunity()` are no-ops. Predictive interventions write nowhere.
- `packages/database/src/services/platform/invoice-adjustment.service.ts:63` — `loadInvoice()` stub.
- `packages/database/src/services/kernel-grounding.service.ts:57` — grounding provider returns empty facts (this one is **evidence-chain relevant** — empty grounding weakens the "evidence-required AI output" rail).
- `packages/database/src/services/kernel-cohort.service.ts:55` — cohort stats return empty.
**One-line fix:** rewrite each against the real mining schema (market_rate_snapshots / predictions / cohort tables) OR delete the service + its wiring if the mining product does not need it. Decide per-service; do not leave them as silent no-ops.

#### H2 — 31 skipped tests, all property-domain `R4 TODO`, all in api-gateway (skipped-test)
**Count:** 31 `it.skip`/`describe.skip`. **Quick-win?** NO — coupled to H1.
Every skip is tagged `R4 TODO 2026-05-29 — vestigial / BossNyumba property-domain`. They test the exact stubs in H1 (market-surveillance, predictive-interventions, arrears, manager-app, role-gate, unit-components, agency-binding). Worst offenders:
- `services/api-gateway/src/composition/__tests__/agency-binding.test.ts:162,200,240,291,340,381,426,466` — 8 skipped `describe`s for property ports (notifications/work-orders/inspections/arrears/marketplace/lease/vacancy reads).
- `services/api-gateway/src/composition/__tests__/predictive-interventions-wiring.test.ts:263,345,390,409,423` — 5 skips.
- `services/api-gateway/src/routes/__tests__/role-gate.test.ts:45,63,85,112,127` — 5 skips for pruned property routes (customers/leases/invoices/properties/units, issue #165).
- `services/api-gateway/src/composition/__tests__/market-surveillance-wiring.test.ts:289,316,380` — 3 skips.
- `services/api-gateway/src/routes/bff/__tests__/manager-app.test.ts:102,160,247,268` — 4 skips.
**One-line fix:** when H1 stubs are rewritten or deleted, rewrite the matching test against mining tables (un-skip) OR delete the test file alongside the deleted service. A skipped test referencing a deleted domain is itself debt — remove it.

---

### MED

#### M1 — `as unknown as` double-cast type holes (type-suppression) — THE big one
**Count:** **1085** (real source; 0 in comments — all real casts). **Quick-win?** Partly — design one helper, then mechanical.
Concentration: `services/api-gateway` 427 · `services/domain-services` 302 · `packages/ai-copilot` 49 · `packages/database` 30 · `services/payments-ledger` 17. Two recurring shapes:
- Drizzle row mapping: `(rows as unknown as VendorRowLike[]).map(mapVendorRow)` — e.g. `services/domain-services/src/vendors/postgres-vendor-repository.ts:348,364,374,396`.
- Brand-type coercion: `tenantId as unknown as string`, `a.createdAt as unknown as string` — e.g. `services/domain-services/src/site-live-metrics/drizzle-site-live-metrics-source.ts:71`, `services/domain-services/src/waitlist/waitlist-vacancy-handler.ts:130-131`.
**One-line fix:** introduce a typed `mapRow<TRow, TDomain>()` / `unwrapBrand()` boundary helper in `packages/database` so Drizzle results are validated (zod or generated row types) at the ORM seam; replace the casts call-site by call-site. This removes the largest type-unsafety surface and most of the paired `eslint-disable no-explicit-any`.

#### M2 — `as any` casts in product source (type-suppression)
**Count:** **114**. **Quick-win?** Mostly YES. Concentration: `api-gateway` 75 · `central-intelligence` 28.
Most are `(db as any).execute(rendered)` raw-SQL escapes — e.g. `services/api-gateway/src/composition/service-registry.ts:1985,1990,2256`, `orchestrator-bindings.ts:934`. A few are `(globalThis as any).crypto` shims (`cognitive-wiring.ts:299`).
**One-line fix:** type the Drizzle `execute` escape hatch once (a `RawSqlExecutor` interface) and the `globalThis` shim once; the rest fall away. ~half are deletable immediately, the SQL-execute ones share one helper with M1.

#### M3 — `@ts-expect-error` / `@ts-ignore` in product code (type-suppression)
**Count:** **10** product-src (16 total minus 6 intentional-in-tests). **Quick-win?** YES.
Sites: `packages/genui` (the 7 non-test ones), `services/consolidation-worker` 4, `services/sleep-pass-orchestrator` 1, `packages/agent-platform` 1, `apps/admin-web` 2, `apps/owner-web` 1. The 6 in `packages/genui/src/__tests__/adaptive-renderer.test.tsx:22,62,89` are **intentional** (feeding malformed props to exercise schema guards) — leave them.
**One-line fix:** each is a single-line type-narrowing; fix the underlying type and delete the directive. Trivial per-site.

#### M4 — NOT_YET_WIRED external-integration placeholders (unwired-stub, by design)
**Count:** ~10 typed slots in `NOT_YET_WIRED_REASON`. **Quick-win?** NO — needs 3rd-party creds/contracts.
This is a **deliberate fail-closed pattern** (`packages/central-intelligence/src/kernel/not-yet-wired.ts` → frozen enum + `NotYetWiredError`; `audit-not-yet-wired.mjs` reports **0 violations**). Real external gateways not yet contracted: `NIDA_PORT` (national-ID biometric), `EARDHI_PORT` (e-Ardhi title-deed), `KRA_MRI_DISPATCHER` (KRA tax filing), `LICENCE_SUSPENSION_DISPATCHER` / `OWNER_PAYOUT_DISPATCHER` (Temporal workflows). Surfaced honestly via `routes/health-dependencies.router.ts`.
**One-line fix:** activate each adapter when the env/credentials land (the code already switches from stub→real on env presence). This is NOT removable debt — it is correct "honest-unwired" behaviour until the integration exists. Track as integration tasks, not code-cleanup.

---

### LOW

#### L1 — single real product TODO (TODO)
**Count:** 1. **Quick-win?** YES (but blocked on a missing endpoint).
`apps/owner-web/src/lib/session.ts:31` — tenant display fields (legal name, region, plan, site list, salutation) fall back to identity-neutral defaults because the gateway has no `GET …/sites` endpoint yet; the doc-comment says this is "the ONLY remaining mock surface" in owner session hydration. Fail-safe behaviour is correct (no crash, no hardcoded role).
**One-line fix:** add the gateway sites endpoint + a tenant-profile read, then hydrate from it and delete the fallback. Overlaps `MASTER_GAP_REGISTER` embodiment/BFF rows.

#### L2 — `R4 TODO` doc-comments in skip blocks (TODO, cosmetic)
**Count:** ~28. **Quick-win?** Resolved by H2.
These are explanatory comments inside the H2 skipped tests, not standalone debt. They vanish when H2's test files are rewritten or deleted.

#### L3 — `eslint-disable` directives (policy-acknowledged, not latent debt)
**Count:** 443 raw. **Quick-win?** N/A — already justified.
318 `no-explicit-any` (pair with M1/M2), 93 `no-console` (CLI/seed/script stdout), 56 `security/detect-non-literal-fs-filename` (audit scripts walking the repo). Listed for completeness; not on the zero-debt critical path. Closing M1/M2 auto-removes the `no-explicit-any` subset.

---

## Quick-win vs needs-design split

**Quick-wins (do now, low risk):**
- L1 (1 TODO — once sites endpoint exists), M3 (10 `@ts-*` directives), the `as any` `globalThis` shims in M2 (~10 sites). 
- The deletable half of M2 / `(db as any).execute` once the `RawSqlExecutor` interface lands.

**Needs-design (sequence them):**
1. **M1** — one typed `mapRow`/brand-unwrap helper in `packages/database`, then mechanical replace of 1085 casts. Biggest payoff, biggest blast radius — do behind the helper, package-by-package.
2. **H1 → H2 (coupled)** — decide per stub service: rewrite for mining schema OR delete. Then un-skip-and-rewrite OR delete the matching 31 tests. Never leave a skipped test pointing at a deleted/no-op service.
3. **M4** — external-integration activation (NIDA/e-Ardhi/KRA/Temporal); gated on credentials/contracts, track as integration work, keep the fail-closed stubs until then.

## What is already at zero (do not regress)
- `it.only`/`fdescribe`: **0** · empty `catch {}`: **0** · HACK/XXX: **0** · NOT_YET_WIRED audit violations: **0** · real product TODO/FIXME: **1**.
- `@ts-*` in real source: **16** total (10 product, 6 intentional-test). For a monorepo of ~11,760 scanned files this is an exceptionally clean suppression surface.

## Method / commands (reproduce)
- Markers: `grep -rnE 'TODO|FIXME|HACK|XXX|NOT_YET_WIRED|@ts-ignore|@ts-expect-error|eslint-disable'` over `packages services apps`, excluding `node_modules|/dist/|/.next/|/build/|/coverage/`. **The `.next/` exclusion is essential** — without it the app `@ts-expect-error` counts are inflated ~12× by compiled output.
- Skips: `grep -rnE '(it|describe|test)\.(skip|only)\(' …` filtered for `skipIf`/`process.exit` false-positives.
- Casts: `\bas any\b` and `as unknown as` with `0-in-comments` verification.
- Audit scripts: `node scripts/audit-not-yet-wired.mjs` → 0 violations / 11,760 files. `pnpm knip` / `node scripts/knip.mjs` → **OOM** (monorepo too large for a single-process pass; tooling limit, not a finding — run per-package or raise `--max-old-space-size` to get dead-export data).
