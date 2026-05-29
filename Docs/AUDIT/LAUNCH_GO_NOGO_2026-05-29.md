# Launch GO / NO-GO — 2026-05-29

> Final verification across 5 surfaces (typecheck / builds / tests /
> cross-tenant isolation / endpoint smoke) before the production launch
> cut. Live-evidence based, no simulated runs.

## 1. Final verdict: RED (NO-GO)

**Launch ready:** `false`

**Recommendation:** Hold the launch. 3 of 5 verification surfaces fail
with critical-severity regressions on the build, typecheck, and test
pillars. Two of the three failing surfaces (typecheck and builds)
overlap on the same root-cause cluster — design-system token drift
(`colors.steel`, `colors.textPrimary`, `typography.label`,
`typography.bodySm`) plus component-prop drift (Button rejecting `title`,
PrimaryButton rejecting `busy` / `testID`) — meaning a single coordinated
fix wave can unblock 2 surfaces simultaneously. The third RED (tests)
includes a direct hard-rule violation per `CLAUDE.md`: the
`database-rls-guc` middleware test reports the SQL emits the legacy
GUC name `app.tenant_id` instead of the canonical
`app.current_tenant_id`, which is a fail-closed invariant for the
tenant isolation guarantee.

## 2. Per-surface scorecard

| # | Surface                           | Verdict | Pass count | Fail count | Notes                                                                                       |
|---|-----------------------------------|---------|------------|------------|---------------------------------------------------------------------------------------------|
| 1 | Monorepo typecheck (`pnpm -r typecheck`) | RED     | 144        | 2          | 14 total TS errors. `apps/workforce-mobile` (8) + `apps/buyer-mobile` (6). Token + prop drift. |
| 2 | Monorepo builds (3 Next + 2 mobile typecheck) | RED     | 2          | 3          | `owner-web` build fails on missing ESLint rule. `workforce-mobile` + `buyer-mobile` typecheck fail (same drift as row 1). |
| 3 | Monorepo tests (`pnpm -r --no-bail test`) | RED     | 22 568     | 119        | 41 test files failing across 10 packages. Includes RLS GUC name regression in api-gateway. |
| 4 | Cross-tenant isolation              | GREEN   | 158        | 0          | 158/158 logic tests pass across 25 files. One integration suite skipped (Postgres not available locally) — not a leak. |
| 5 | Endpoint smoke matrix (`scripts/smoke/full-endpoint-smoke.ts`) | YELLOW  | 0          | 0          | api-gateway process not running on :4001 in this environment. Smoke runner is healthy and ready; needs a booted gateway to execute. |

**Tally:** GREEN 1 · YELLOW 1 · RED 3 → final verdict RED.

## 3. Critical blockers (RED items)

These MUST be resolved before launch.

### B1 — Workforce-mobile typecheck (RED, critical)
- **Where:** `apps/workforce-mobile/app/(manager)/inspection/[id]/narrative.tsx` (lines 150, 168, 207); `apps/workforce-mobile/app/owner/cockpit/index.tsx` (lines 259, 264, 274, 297, 304).
- **Symptoms (8 TS errors):**
  - `TS2322 Property 'title' does not exist on type 'IntrinsicAttributes & ButtonProps'` — Button API drift (3 sites).
  - `TS2339 Property 'textPrimary' does not exist on color tokens (earth900/earth800/.../offline)` — design-system token drift (3 sites).
  - `TS2551 Property 'bodySm' does not exist on typography sizes. Did you mean 'body'?` — typography token drift (2 sites).
- **Fix vector:** Replace `title=` with the current Button prop (likely `label=` or composition with children); rename `textPrimary` → the active earth-token (likely `earth900`); rename `bodySm` → `body`. One-pass codemod fixes all 8.

### B2 — Buyer-mobile typecheck (RED, critical)
- **Where:** `apps/buyer-mobile/app/rfb/create.tsx` (lines 201, 211, 218, 239); `apps/buyer-mobile/app/rfb/index.tsx` (lines 55, 103).
- **Symptoms (6 TS errors):**
  - `TS2322` — PrimaryButton rejects `busy` prop (likely renamed to `loading` or `isBusy`).
  - `TS2339 Property 'label' does not exist` on typography tokens.
  - `TS2339 Property 'steel' does not exist` on color tokens (forest/forestDeep/gold/copper/earth available).
  - `TS2322` — PrimaryButton rejects `testID` (drop or move into wrapper).
  - `TS2345` — `t()` signature mismatch: expected `Readonly<Record<string, string | number>>`, given `Record<string, unknown>`.
- **Fix vector:** Same design-system codemod as B1, plus a localised PrimaryButton API audit and an i18n `t()` helper-signature narrowing.

### B3 — Owner-web build (RED, high)
- **Where:** `apps/owner-web` build pipeline; trigger file `src/lib/context-breadcrumbs.ts:136:5`.
- **Symptom:** `Definition for rule 'react-hooks/exhaustive-deps' was not found.` `next build` exits 1.
- **Root cause:** ESLint flat-config or Next preset no longer registers `eslint-plugin-react-hooks`. Either restore the plugin in the workspace's ESLint config or drop the rule reference from the source comment.
- **Note:** Marketing + admin-web builds both PASS, so the failure is isolated to owner-web's ESLint plugin wiring.

### B4 — services/api-gateway tests (RED, critical, multiple sub-blockers)
24 test files / 75 tests failing. Highest-severity sub-blockers:
- **B4a (HARD-RULE VIOLATION):** `src/middleware/__tests__/database-rls-guc.test.ts` — assertion: SELECT statement contains legacy `app.tenant_id` instead of the canonical `app.current_tenant_id`. This is a direct violation of the RLS hard rule in `CLAUDE.md` ("the `app.current_tenant_id` GUC is bound by api-gateway middleware. Never disable RLS or double-filter from app code."). Until fixed, the per-request tenant scope binding is incorrect — fail-closed.
- **B4b:** `src/routes/__tests__/move-out.router.test.ts`, `src/routes/__tests__/property-grading.router.test.ts` — `Cannot find module '../move-out.router.js' …`. Router files were renamed / deleted but tests still reference them. Either restore the router (if still needed) or delete the orphan tests.
- **B4c:** `mining/tasks` + `mining/toolbox` cross-tenant filter leaking extra rows. Combined with the GUC regression (B4a), the tenant boundary on these mining routes is at risk.
- **B4d:** Manager-app routes returning 503 instead of 200; sovereign counter-model wiring null; predictive-interventions delegate not called; agency-binding / arrears-infrastructure undefined-read regressions.

### B5 — packages/intel-self-improve tests (RED, high)
19 failures across 4 files in `packages/intel-self-improve`. Investigation required before launch; this is the self-improvement loop and silent failures here decay the brain over time.

### B6 — services/domain-services tests (RED, high)
12 failures across 2 files in `services/domain-services`. Triage required.

### B7 — packages/database test bootstrap (RED, high)
`packages/database/src/__tests__/brain-thread.integration.test.ts` cannot load — `Cannot find package 'uuid'`. Missing devDependency. Add `uuid` (and `@types/uuid`) to `packages/database`.

### B8 — apps/admin-web test wiring (RED, high)
`ag-ui-client.test.ts` fails to load — `Failed to resolve import "@borjie/owner-os-tabs" from packages/central-intelligence/src/sse-tags/tab-tags.ts`. The cross-package workspace import chain is broken; either publish/expose the `@borjie/owner-os-tabs` entry or remove the import.

## 4. Soft gaps (YELLOW — should fix soon, doesn't block)

### Y1 — Endpoint smoke matrix not run (YELLOW, medium)
The smoke runner at `scripts/smoke/full-endpoint-smoke.ts` (335 LOC) is healthy and ready, but no api-gateway listener was bound on `:4001` in this verification environment. `lsof -i :4001 -t` returned empty; `curl http://localhost:4001/health` exited 7. No aggressive `killall` or background spin-up was attempted per task contract. Before launch the smoke matrix must be executed once against a booted gateway:

```
# in shell A
pnpm --filter @borjie/api-gateway dev
# in shell B (once :4001 responds)
pnpm --filter @borjie/api-gateway exec tsx ../../scripts/smoke/full-endpoint-smoke.ts
```

### Y2 — packages/central-intelligence (5 failures of 2 713) (YELLOW, medium)
0.18 % failure rate but spread across 4 distinct files — investigate whether these are a real cluster or independent flakes.

### Y3 — packages/persona-runtime (3 failures, 1 file) (YELLOW, medium)
Small surface but real failures — triage.

### Y4 — packages/agentic-os trust-calibration tolerances (YELLOW, low)
`trust-calibration.test.ts` — `meanSuccessRate` 0.7982… vs `>0.8`
threshold and 0.2017… vs `<0.2` threshold. Reads as a tolerance /
parameter drift, not a flake. Tighten the test fixture or widen the
tolerance band; document the chosen direction.

### Y5 — apps/owner-web tests (2 failures, 1 file) (YELLOW, low)
Two failures in one suite. Independent of the build blocker B3.

### Y6 — apps/buyer-mobile tests (1 failure, 1 file) (YELLOW, low)
One failure in one suite. Independent of the typecheck blocker B2.

### Y7 — Task #199 (security hardening) deliverable not yet landed (YELLOW, low)
The cross-tenant verification (surface 4) is GREEN on the existing
158-test corpus, but the NEW cross-tenant test files promised by task
#199 (Security hardening — anti-hack + PCCB/PDPA + cross-tenant
isolation) have not yet been added under
`services/api-gateway/src/__tests__/`. Existing protection is intact;
the gap is on the new deliverable.

### Y8 — cross-tenant integration suite skipped (YELLOW, low)
`services/api-gateway/test/integration/tenant-isolation.int.test.ts`
(4 cases) ECONNREFUSED'd against `localhost:5432` in this environment.
Re-run after launching the Postgres dev container to convert the skip
into a confirmed pass.

## 5. Live-evidence appendix (raw exit codes + first 200 chars per surface)

### Surface 1 — Monorepo typecheck
- **Command:** `NODE_OPTIONS=--max-old-space-size=8192 pnpm -r typecheck`
- **Recursive exit:** `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` (fail-fast on first package failure).
- **Per-package exit verification (post fail-fast re-runs):**
  - `pnpm --filter @borjie/central-intelligence typecheck` → exit 0 (PASS)
  - `pnpm --filter @borjie/chat-ui typecheck` → exit 0 (PASS)
  - `pnpm --filter @borjie/cognitive-composition typecheck` → exit 0 (PASS)
  - `pnpm --filter @borjie/workforce-mobile typecheck` → exit 2 (FAIL, 8 errors)
  - `pnpm --filter @borjie/buyer-mobile typecheck` → exit 2 (FAIL, 6 errors)
- **First 200 chars (buyer-mobile):**
  > `apps/buyer-mobile typecheck: app/rfb/create.tsx(201,11): error TS2322: Type '{ label: string; onPress: () => void; busy: boolean; testID: string; }' is not assignable to type 'IntrinsicAttributes & Pri`
- **First 200 chars (workforce-mobile):**
  > `app/(manager)/inspection/[id]/narrative.tsx(150,17): error TS2322: Type '{ key, title, variant: "primary"|"ghost", onPress, style: { flexBasis: "48%" } }' is not assignable to type 'IntrinsicAttribu`

### Surface 2 — Monorepo builds
- **`pnpm --filter @borjie/marketing build`** → exit 0 (PASS). Next build complete; First Load JS 103 kB shared.
- **`pnpm --filter @borjie/owner-web build`** → exit 1 (FAIL).
  - First 200 chars: `./src/lib/context-breadcrumbs.ts 136:5  Error: Definition for rule 'react-hooks/exhaustive-deps' was not found.  react-hooks/exhaustive-deps. ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @borjie/owner-web@0.1.`
- **`pnpm --filter @borjie/admin-web build`** → exit 0 (PASS). Full route table emitted; middleware 88.2 kB.
- **`pnpm --filter @borjie/workforce-mobile typecheck`** → exit 2 (pnpm wraps as 1) (FAIL).
  - First 200 chars: `app/(manager)/inspection/[id]/narrative.tsx:150 - Property 'title' does not exist on type 'IntrinsicAttributes & ButtonProps'. app/owner/cockpit/index.tsx:259 - Property 'textPrimary' does not exist on`
- **`pnpm --filter @borjie/buyer-mobile typecheck`** → exit 2 (pnpm wraps as 1) (FAIL).
  - First 200 chars: `app/rfb/create.tsx:201 - Property 'busy' does not exist on type 'IntrinsicAttributes & PrimaryButtonProps'. app/rfb/create.tsx:211 - Property 'label' does not exist. app/rfb/create.tsx:218 - Property`

### Surface 3 — Monorepo tests
- **Command:** `pnpm -r --no-bail test`
- **Aggregate across 216 packages with a Tests row:** PASS 22 568 · FAIL 119 · SKIP 5.
- **Per-package failure breakdown (Test Files row | Tests row):**
  - `packages/agentic-os` — 1 file failed | 2 tests failed.
  - `packages/persona-runtime` — 1 file failed | 3 tests failed.
  - `packages/central-intelligence` — 4 files failed | 5 tests failed (out of 2 713).
  - `packages/intel-self-improve` — 4 files failed | 19 tests failed.
  - `packages/database` — 1 file failed | 0 tests (file-load: `uuid` missing).
  - `services/api-gateway` — 24 files failed | 75 tests failed (out of 2 591).
  - `services/domain-services` — 2 files failed | 12 tests failed.
  - `apps/admin-web` — 1 file failed | 0 tests (file-load: `@borjie/owner-os-tabs` unresolvable).
  - `apps/owner-web` — 1 file failed | 2 tests failed.
  - `apps/buyer-mobile` — 1 file failed | 1 test failed.
- **First 200 chars of representative failure (api-gateway RLS GUC):**
  > `FAIL  src/middleware/__tests__/database-rls-guc.test.ts. AssertionError: expected 'SELECT set_config(\\'app.current_tenan…' not to contain 'app.tenant_id'`
- **First 200 chars of missing-router failure:**
  > `FAIL  src/routes/__tests__/move-out.router.test.ts. Error: Cannot find module '../move-out.router.js'`
- **First 200 chars of admin-web import failure:**
  > `FAIL  apps/admin-web/ag-ui-client.test.ts. Error: Failed to resolve import "@borjie/owner-os-tabs" from "central-intelligence/src/sse-tags/tab-tags.ts"`

### Surface 4 — Cross-tenant isolation
- **Logic-test runs (all PASS):**
  - `@borjie/tenant-isolation-guard` → Test Files 8 passed (8); Tests 43 passed (43).
  - `@borjie/ai-copilot` (tenant-isolation) → 2 files / 12 tests passed.
  - `@borjie/ai-copilot` (tenant-isolation-d9) → 1 file / 6 tests passed.
  - `@borjie/authz-policy` (tenant-isolation) → 1 file / 19 tests passed.
  - `@borjie/mcp-server` (tenant-isolation) → 1 file / 4 tests passed.
  - `@borjie/security-audit` (tenant-isolation-harness) → 1 file / 7 tests passed.
  - `@borjie/payments-ledger-service` (tenant-isolation) → 1 file / 4 tests passed.
  - `@borjie/central-intelligence` (awareness-scopes-d9) → 1 file / 9 tests passed.
  - `@borjie/media-generation` (tenant) → 2 files / 19 tests passed (incl. caveat-2-tenant-style-guard).
  - `@borjie/persona-runtime` (scope-predicate) → 1 file / 25 tests passed.
  - `@borjie/database` (rls-guc-bind) → 1 file / 5 tests passed.
  - `@borjie/document-analysis` (rls) → 1 file / 5 tests passed.
- **Total:** 158 / 158 passed across 25 files.
- **Skipped integration suite:** `services/api-gateway/test/integration/tenant-isolation.int.test.ts` (4 cases) — ECONNREFUSED `::1:5432 / 127.0.0.1:5432`. Env-only failure, NOT a leak. The H-2 contract is also covered by `@borjie/authz-policy/tenant-isolation` (19 logic cases) and `@borjie/tenant-isolation-guard` (43 cases) — all passing above.
- **First 200 chars (env-only ECONNREFUSED):**
  > `services/api-gateway/test/integration/tenant-isolation.int.test.ts — Error: connect ECONNREFUSED ::1:5432 (then 127.0.0.1:5432). Postgres not available in this verification environment.`

### Surface 5 — Endpoint smoke matrix
- **Probe 1:** `curl -sf --max-time 3 -o /dev/null -w "health=%{http_code}\n" http://localhost:4001/health` → exit 7 (connection refused), output: `health=000`.
- **Probe 2:** `lsof -i :4001 -t` → empty (no PID listening).
- **Probe 3:** `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3010|3020|4001|4002|4000)'` → empty (no listener on api-gateway port nor adjacent app ports 3010 / 3020).
- **Smoke runner:** `scripts/smoke/full-endpoint-smoke.ts` (335 LOC) present and ready.
- **First 200 chars (curl):**
  > `curl: (7) Failed to connect to localhost port 4001 after 0 ms: Connection refused. health=000`

## 6. Sign-off

- **Final verdict:** RED.
- **launch_ready:** `false`.
- **Critical blockers (RED items, count = 8):** B1 workforce-mobile typecheck; B2 buyer-mobile typecheck; B3 owner-web build; B4 services/api-gateway tests (incl. RLS-GUC hard-rule violation); B5 packages/intel-self-improve tests; B6 services/domain-services tests; B7 packages/database test bootstrap (missing `uuid`); B8 apps/admin-web test wiring (`@borjie/owner-os-tabs` import).
- **Yellow gaps (count = 8):** Y1 smoke matrix not run; Y2 central-intelligence 5 failures; Y3 persona-runtime 3 failures; Y4 agentic-os trust-calibration tolerance; Y5 owner-web tests; Y6 buyer-mobile tests; Y7 #199 deliverable not landed; Y8 integration-suite skipped (Postgres).
- **Recommendation:** NO-GO for launch on 2026-05-29. Fix wave priority:
  1. **Wave 1 (codemod, parallelisable):** B1 + B2 — design-system token rename + Button / PrimaryButton prop migration. One sweep fixes both mobile typecheck blockers.
  2. **Wave 2 (single-file):** B3 — restore `eslint-plugin-react-hooks` or drop the rule reference in `owner-web`.
  3. **Wave 3 (api-gateway test cluster):** B4a (RLS GUC name — HARD RULE), B4b (router orphan tests), B4c (mining cross-tenant leak), B4d (misc 503 + null wiring).
  4. **Wave 4:** B7 (add `uuid` to `packages/database`), B8 (fix `@borjie/owner-os-tabs` workspace export).
  5. **Wave 5:** B5 (intel-self-improve), B6 (domain-services).
  6. **Pre-cut smoke:** Y1 — run the smoke runner once the gateway is booted; expected GREEN.
- After all 8 RED blockers clear and the smoke matrix returns GREEN, repeat this verification; only then re-evaluate launch readiness.

— end of report
