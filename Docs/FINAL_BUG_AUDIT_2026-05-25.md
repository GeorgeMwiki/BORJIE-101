# Final Bug Audit — 2026-05-25

Audit run after the P66 merge (`3b8e63af`) brought 1731 files / +214K LoC from `main`. Read-only audit; this file is the only artefact written.

## Executive summary
- TIER 1 (CRITICAL): 4 findings — TypeScript will fail to build; runtime crash on every request
- TIER 2 (HIGH): 7 findings — composition wiring gaps + duplicate exports
- TIER 3 (MEDIUM): 4 findings — code smell + console.warn drift
- TIER 4 (LOW): 2 findings
- **Total: 17 findings**

> **HEADLINE:** The merge from `main` (commit `3b8e63af`) silently removed the `persistentStores` and `documentStorage` slots from `ServiceRegistry` while leaving 7+ consumer files still reading those slots. The dist/ snapshot pre-dates the merge (May 24 20:33), so the broken code has never been built. Live test WILL crash on first request.

---

## Critical findings — must fix before live test

### BUG-CR-1: `registry.persistentStores` slot removed by main-merge — every request will crash
- **Files affected (READS the missing slot):**
  - `services/api-gateway/src/composition/service-context.middleware.ts:53-60` (5 references, runs on every `api.use('*')` request)
  - `services/api-gateway/src/index.ts:579` (boot summary)
  - `services/api-gateway/src/composition/__tests__/persistent-stores-registry-integration.test.ts:58-141` (entire suite reads `registry.persistentStores.*`)
  - `services/api-gateway/src/__tests__/persistent-stores-context-wiring.test.ts:78-136` (entire suite)
- **Symptom:** TypeScript fails (`Property 'persistentStores' does not exist on type 'ServiceRegistry'`); runtime throws `TypeError: Cannot read properties of undefined (reading 'lessonStore')` at the FIRST request through `createServiceContextMiddleware` (mounted at `services/api-gateway/src/index.ts:680` via `api.use('*', createServiceContextMiddleware(serviceRegistry))`).
- **Root cause:** The merge resolved `services/api-gateway/src/composition/service-registry.ts` by accepting the `main` branch's pre-session version, which never had:
  - the `import { createPersistentStores, type PersistentStores } from './persistent-stores-wiring.js'` block
  - the `import { createDocumentStorageWiring, type DocumentStorageWiring } from './document-storage-wiring.js'` block
  - the `import { createMultiLLMSynthesizerWiring, type MultiLLMSynthesizerWiring } from './multi-llm-synthesizer-wiring.js'` block
  - the corresponding `readonly persistentStores: PersistentStores` and `readonly documentStorage: DocumentStorageWiring` slots on the `ServiceRegistry` interface (l.440-803)
  - the `persistentStores: createPersistentStores({ db: null })` and `documentStorage: createDocumentStorageWiring()` initialisers in both `degradedRegistry()` (l.981-1157) and `buildServicesInner()` (l.1177-end)
- **Suggested fix:** Re-add the 3 import blocks to `service-registry.ts`, re-add the slots to the `ServiceRegistry` interface, and initialise them in both `degradedRegistry()` and `buildServicesInner()` (live path passes `db`, degraded path passes `null`). Pattern lives in `services/api-gateway/dist/index.js:28451-28456` (last successful build).
- **Confidence:** high

### BUG-CR-2: `packages/observability/src/index.ts` exports 9 symbols that don't exist
- **File:** `packages/observability/src/index.ts:17-29`
- **Symptom:** `tsc --noEmit` fails with `TS2305: Module '"./security/with-security-events.js"' has no exported member 'withSecurityEventsFastify'` (and 8 more). Any consumer of `@borjie/observability` fails to type-check.
- **Root cause:** Merge UNION-merged the barrel as if `with-security-events.ts` had a Fastify variant + Next.js variant + a sink-registration API (`set/get/resetSecurityEventSink`) + 4 types (`SecurityEvent`, `SecurityEventBinding`, `SecurityEventSeverity`, `SecurityEventSink`). The file only defines 6 exports: `AuditableContext`, `AuditableNext`, `WithSecurityEventsOptions`, `withSecurityEvents`, `securityEventsMiddleware`, `recordSecurityEvent`. Additionally `withSecurityEvents` and `recordSecurityEvent` are exported twice (lines 18+150 and 21+152).
- **Suggested fix:** Either delete the phantom exports from `index.ts` (lines 19, 20, 22, 23, 24, 25-28), OR add the missing implementations + types to `with-security-events.ts`. Remove the duplicate `withSecurityEvents` (l.150) + `recordSecurityEvent` (l.152) exports — only 1 declaration each.
- **Confidence:** high

### BUG-CR-3: `services/api-gateway/package.json` missing `@borjie/strategic-reports` workspace dep
- **File:** `services/api-gateway/package.json` (the package list does NOT include `@borjie/strategic-reports`)
- **Affected consumers:**
  - `services/api-gateway/src/routes/reports/engine-wiring.ts:18` imports `type { ReportEngine }`
  - `services/api-gateway/src/routes/reports/reports.router.ts:38` imports `ReportSpecSchema, type ReportSpec, type ReportType, type PersistedReport`
  - `services/api-gateway/src/routes/reports/__tests__/reports.router.test.ts:33` imports
- **Symptom:** `pnpm install` succeeds but `pnpm build` fails with `Cannot find module '@borjie/strategic-reports'` because the workspace symlink is never created.
- **Suggested fix:** Add `"@borjie/strategic-reports": "workspace:*"` to `dependencies` block of `services/api-gateway/package.json` (alphabetically next to `stage-advisor` / `storage-adapter`).
- **Confidence:** high

### BUG-CR-4: `services/api-gateway/src/composition/service-context.middleware.ts` lacks `@ts-nocheck`, will fail compile
- **File:** `services/api-gateway/src/composition/service-context.middleware.ts:1-30` (no `@ts-nocheck` directive)
- **Symptom:** Because of BUG-CR-1, the 5 accesses to `registry.persistentStores.*` (lines 53-60) become hard type errors. Unlike other middleware files (`auth.middleware.ts`, `kill-switch.middleware.ts`) which carry `@ts-nocheck`, this file is fully type-checked.
- **Root cause:** Same as BUG-CR-1.
- **Suggested fix:** Fix BUG-CR-1 (re-add the slot). Do NOT band-aid with `@ts-nocheck` because the runtime crash would still happen.
- **Confidence:** high

---

## High findings — should fix this week

### BUG-HI-1: 11 new LITFIN-port packages are completely unwired (PO-7/8/9/12/14/15/16/18/19/21/32/37/40)
- **Packages:** `audit-hash-chain`, `memory-tool-wire-adapter`, `ocsf-emitter`, `mcp-cost-persistence`, `probe-runners`, `property-voices-debate`, `cross-org-denial-recorder`, `conformal-calibration-online`, `memory-v2`, `llm-budget-governor`, `fairness-eval`. Plus 2 services with no Dockerfile/k8s/compose: `services/apollo-gauntlet-runner`, `services/sleep-pass-orchestrator`.
- **Symptom:** 13 new packages/services ship their `createX({...})` factories but no caller imports them. They are dead code in the binary.
- **Wiring snippets needed (composition root in `services/api-gateway/src/composition/service-registry.ts`):**

| Package | Snippet |
|---|---|
| `audit-hash-chain` | `import { appendEntry, verifyChain } from '@borjie/audit-hash-chain'; // wire into WORM audit-chain verifier cron` |
| `memory-tool-wire-adapter` | `import { topicFilesToMemoryWire } from '@borjie/memory-tool-wire-adapter'; // wire into Anthropic Memory tool path` |
| `ocsf-emitter` | `import { emitEvent, mapInternalEventToOcsf, createLineSink } from '@borjie/ocsf-emitter'; // wire as a sink onto the audit-logger` |
| `mcp-cost-persistence` | `import { createCostBuffer, runProbeCycle } from '@borjie/mcp-cost-persistence'; // wire into mcp-server gateway` |
| `probe-runners` | `import { runSycophancyProbe, runDefectionProbe } from '@borjie/probe-runners'; // wire into eval CI gate (.github/workflows)` |
| `property-voices-debate` | `import { runPropertyVoicesDebate } from '@borjie/property-voices-debate'; // wire into ai-copilot debate route` |
| `cross-org-denial-recorder` | `import { recordDenial, createRecorderState, createInMemorySink } from '@borjie/cross-org-denial-recorder'; // wire into authz-policy denial hook` |
| `conformal-calibration-online` | `import { createOnlineConformalState, updateConformal } from '@borjie/conformal-calibration-online'; // wire into forecasting predict path` |
| `memory-v2` | `import { createMemoryV2 } from '@borjie/memory-v2'; // wire as replacement for createInMemoryConversationMemory at l.1078` |
| `llm-budget-governor` | `import { createLLMBudgetGovernor, createInMemoryBudgetStore } from '@borjie/llm-budget-governor'; // wire on llmRouter at l.1019` |
| `fairness-eval` | `import { createFairnessEval } from '@borjie/fairness-eval'; // wire into authz-policy + ai-copilot risk decision path` |
| `apollo-gauntlet-runner` | service has no Dockerfile/k8s/compose — add to `k8s/` or skip if intended as a CLI |
| `sleep-pass-orchestrator` | service has no Dockerfile/k8s/compose — add to `k8s/` or skip if intended as a CLI |

### BUG-HI-2: Additional unwired packages from earlier P38+P41-P62 waves
- **Packages with zero external consumers:** `analytics`, `knowledge-graph`, `compliance-pack`, `security-hardening`, `document-ai`, `progressive-intelligence`, `document-quality-guarantor`, `audio-capture`, `agent-runtime`, `mcp`, `agent-orchestrator`, `open-coding-agent-patterns`, `openclaw-operating-model`, `agentic-os`
- **Symptom:** These all live in `packages/` with full code + tests but no consumer in `services/` or `apps/` imports them.
- **Suggested fix:** Audit each against its source spec and wire the factories from the composition root, OR archive them under `packages/_unwired/` with a README explaining why.
- **Confidence:** high (14 packages confirmed by grep -rln of `from '@borjie/<pkg>'`)

### BUG-HI-3: Migration filename collisions in `packages/database/src/migrations/`
- **Collisions:** `0017`, `0018`, `0019`, `0020`, `0023`, `0164`, `0165`, `0166`, `0167`, `0168`, `0169`, `0170` (carbon_market_book vs kill_switch_expand), `0172` (marketplace vs rls), `0174` (payments vs strategic_report_history), `0179` (rls_policies vs missing_tenant_indexes) — **15 duplicates**.
- **Symptom:** Drizzle's snapshot-based migrator dedups by hash but the ordering depends on filename sort, so identical-prefix files may run in non-deterministic order between machines. On fresh apply you may see "relation already exists" errors if two migrations create the same table in inconsistent ordering.
- **Suggested fix:** Rename the newer of each pair to use the next sequential number (e.g. rename `0179_missing_tenant_indexes.sql` → `0186_missing_tenant_indexes.sql`). Run `pnpm db:check` after.
- **Confidence:** high

### BUG-HI-4: `JWT_AUDIENCE` and `JWT_ISSUER` use silent hardcoded fallback (`'borjie'` / `'borjie-api'`)
- **File:** `services/api-gateway/src/middleware/auth.middleware.ts:48-52`
- **Symptom:** If the deployer forgets to set `JWT_AUDIENCE`/`JWT_ISSUER`, tokens issued in one environment will validate in another that shares the JWT secret. Cross-env token leakage risk.
- **Suggested fix:** Wrap with `requireEnv` in production: `process.env.JWT_AUDIENCE || (process.env.NODE_ENV === 'production' ? requireEnv('JWT_AUDIENCE') : 'borjie-api')`. Or stop defaulting in production entirely.
- **Confidence:** medium

### BUG-HI-5: PLATFORM_FEE silent default of 500 bps (5%) when no env set
- **File:** `services/payments-ledger/src/lib/platform-fee.ts:26` (`PLATFORM_FEE_DEFAULT_BPS = 500`)
- **Symptom:** A deployer who forgets to set `PLATFORM_FEE_BPS` charges 5% on every payment with no warning. Not a regression — pre-existing — but the merge re-introduced the silent-default code path with no log/throw.
- **Suggested fix:** Either fail-fast in production when both `PLATFORM_FEE_BPS` and `PLATFORM_FEE_PERCENT` are unset, or emit a `logger.warn` at boot when defaulting.
- **Confidence:** medium

### BUG-HI-6: `document-analysis` extracts currency amounts as `Number` (FP precision loss)
- **File:** `packages/document-analysis/src/extract/entity-extractor.ts:109, 180, 261, 299, 531`
- **Symptom:** `Number.parseFloat('1234567.89')` returns a Number that loses precision above ~15 digits. Document-extracted invoice amounts may drift by 1 minor unit on round-trip through the system.
- **Suggested fix:** Either return as `string` and let downstream Decimal types parse, or scale by 100 + parseInt: `Math.round(parseFloat(raw) * 100)` to store minor units as integers.
- **Confidence:** medium

### BUG-HI-7: `approval-matrix-dsl` parser uses `parseFloat` then `Math.round(value * MICRO_FACTOR)` — overflow silent
- **File:** `packages/approval-matrix-dsl/src/parser.ts:185-189`
- **Symptom:** `parseFloat('1e308')` returns `Infinity`. `Math.round(Infinity * MICRO_FACTOR)` returns `Infinity`. The approval matrix predicate becomes `amountCmp <= Infinity` which silently approves any amount.
- **Suggested fix:** Validate `Number.isFinite(value) && value >= 0` before storing; throw a parse error if not.
- **Confidence:** medium

---

## Medium findings — backlog

### BUG-ME-1: `packages/probe-runners` writes via `console.warn` in production paths
- **Files:** `packages/probe-runners/src/sycophancy-cases.ts:165`, `packages/probe-runners/src/defection-cases.ts:100`
- **Symptom:** Once wired (BUG-HI-1), structured-logger redaction is bypassed.
- **Suggested fix:** Inject a logger port; default to a no-op.

### BUG-ME-2: 6 `JSON.parse` call sites in `services/api-gateway/src/routes/` without try/catch
- **Files:** Run `grep -rn "JSON.parse" services/api-gateway/src/routes` to enumerate
- **Symptom:** Malformed external input crashes the request handler with a 500 instead of a 400.
- **Suggested fix:** Wrap each in try/catch returning `c.json({error: 'INVALID_JSON'}, 400)`.

### BUG-ME-3: New library-style services have no deployment configs
- **Files:** `services/apollo-gauntlet-runner/`, `services/sleep-pass-orchestrator/` — no Dockerfile, no k8s manifest, no docker-compose entry
- **Symptom:** Can't run in any environment.
- **Suggested fix:** Either add Dockerfile + k8s, or move under `packages/` with README explaining they are CLI-only.

### BUG-ME-4: `console.log` left in 2 production code paths inside composition
- **Files:** `services/api-gateway/src/composition/wake-loop-cron.ts:603`, `services/api-gateway/src/composition/consolidation-runner.ts:351`
- **Symptom:** Bypasses PII redaction in pino logger.
- **Suggested fix:** Convert both to `logger.info({...}, '...')`.

---

## Low findings — nice to have

### BUG-LO-1: 11 new LITFIN-port packages have no README
- **Files:** `packages/{audit-hash-chain,memory-tool-wire-adapter,ocsf-emitter,...}/README.md` (missing)
- **Suggested fix:** Add a 5-line README per package: 1-liner purpose + 3-line example.

### BUG-LO-2: No `index.ts` JSDoc on `createInMemorySink` / `createLineSink` exports in ocsf-emitter
- **File:** `packages/ocsf-emitter/src/index.ts:14-19`
- **Suggested fix:** Add a JSDoc on each public factory.

---

## NEW packages composition status

| Package | Has consumer? | Wiring snippet needed |
|---|---|---|
| audit-hash-chain | N | `import { appendEntry, verifyChain } from '@borjie/audit-hash-chain'` (wire into audit-verify-cron) |
| memory-tool-wire-adapter | N | `import { topicFilesToMemoryWire } from '@borjie/memory-tool-wire-adapter'` |
| ocsf-emitter | N | `import { emitEvent, createLineSink, mapInternalEventToOcsf } from '@borjie/ocsf-emitter'` (wire as audit-logger sink) |
| mcp-cost-persistence | N | `import { createCostBuffer, runProbeCycle } from '@borjie/mcp-cost-persistence'` (wire into mcp gateway) |
| probe-runners | N | `import { runSycophancyProbe, runDefectionProbe } from '@borjie/probe-runners'` (wire into eval CI gate) |
| property-voices-debate | N | `import { runPropertyVoicesDebate } from '@borjie/property-voices-debate'` (wire into debate route) |
| cross-org-denial-recorder | N | `import { recordDenial, createRecorderState, createInMemorySink } from '@borjie/cross-org-denial-recorder'` (wire into authz-policy) |
| conformal-calibration-online | N | `import { createOnlineConformalState, updateConformal } from '@borjie/conformal-calibration-online'` (wire into forecasting predict path) |
| memory-v2 | N | `import { createMemoryV2 } from '@borjie/memory-v2'` (replace `createInMemoryConversationMemory` at service-registry.ts:1078) |
| llm-budget-governor | N | `import { createLLMBudgetGovernor, createInMemoryBudgetStore } from '@borjie/llm-budget-governor'` (wire on `llmRouter` at service-registry.ts:1019) |
| fairness-eval | N | `import { createFairnessEval } from '@borjie/fairness-eval'` (wire into authz-policy decision path) |
| apollo-gauntlet-runner | N (service) | needs Dockerfile + k8s manifest + boot |
| sleep-pass-orchestrator | N (service) | needs Dockerfile + k8s manifest + boot |
| analytics | N | (older session — wire into reports composition or document why kept separate) |
| knowledge-graph | N | (older session — wire into brain context provider) |
| compliance-pack | N | (older session — wire into compliance router) |
| security-hardening | N | (older session — wire into auth + rate-limit middleware) |
| document-ai | N | (older session — wire into document-intelligence service) |
| progressive-intelligence | N | (older session — wire into ai-copilot) |
| document-quality-guarantor | N | (older session — wire into document-ai dispatch) |
| audio-capture | N | (older session — wire into voice-agent service) |
| agent-runtime | N | (older session — wire into agentic-os composition) |
| mcp | N | (older session — wire into mcp gateway) |
| agent-orchestrator | N | (older session — wire into multi-agent orchestration path) |
| open-coding-agent-patterns | N | (older session — wire into ai-copilot when coding agent is needed) |
| openclaw-operating-model | N | (older session — wire into autonomy governance) |
| agentic-os | N | (older session — top-level brain composition) |
| forecasting | Y (forecasting-engine + service-registry) | OK |

---

## Pre-existing tech debt confirmed

1. **`packages/observability/src/index.ts` exports 9 phantom symbols** (BUG-CR-2): `withSecurityEventsFastify`, `withSecurityEventsNextRoute`, `setSecurityEventSink`, `getSecurityEventSink`, `resetSecurityEventSink`, `SecurityEvent`, `SecurityEventBinding`, `SecurityEventSeverity`, `SecurityEventSink` — none defined in `with-security-events.ts`.
2. **`packages/observability/src/index.ts` re-exports `withSecurityEvents` and `recordSecurityEvent` twice** (lines 18 + 150, lines 21 + 152) — duplicate-export TS warning.
3. **`services/api-gateway/src/composition/service-registry.ts` removed `persistentStores` and `documentStorage` slots** (BUG-CR-1) but consumers still read them.
4. **`services/api-gateway/package.json` missing `@borjie/strategic-reports`** workspace dep (BUG-CR-3) despite 3 source files importing it.
5. **15 migration filename collisions** in `packages/database/src/migrations/` (BUG-HI-3).
6. **Library-style services without deployment**: `services/apollo-gauntlet-runner`, `services/sleep-pass-orchestrator` (BUG-ME-3).
7. **dist/ is stale** — `services/api-gateway/dist/index.js` was built `May 24 20:33` (pre-merge), so the source has not been compiled since the May 25 04:37 merge.

---

## Top 10 recommended next-wave fixes (prioritized)

1. **BUG-CR-1** — re-add `persistentStores` + `documentStorage` + `multiLLMSynthesizer` slots to `ServiceRegistry` — **effort: M** (2-3 hrs; pattern is in dist + advisor-wiring already)
2. **BUG-CR-2** — delete 9 phantom exports OR add missing implementations to `with-security-events.ts` — **effort: S** (15 min if deleting, half-day if implementing)
3. **BUG-CR-3** — add `@borjie/strategic-reports` to api-gateway package.json — **effort: XS** (1-line edit)
4. **BUG-HI-3** — rename 15 colliding migration files — **effort: S** (mechanical rename + journal regen)
5. **BUG-HI-1** — wire 11 LITFIN-port packages from composition root — **effort: M** (1 per hour ~ 11 hrs total)
6. **BUG-HI-4** — wrap JWT_AUDIENCE/JWT_ISSUER with prod-throw — **effort: XS**
7. **BUG-HI-7** — validate `parseFloat` in approval-matrix-dsl to reject Infinity — **effort: XS**
8. **BUG-HI-6** — switch `document-analysis` currency extraction to integer minor-units — **effort: S**
9. **BUG-HI-2** — wire/archive 14 older session packages — **effort: L** (full-day audit)
10. **BUG-ME-4** — convert 2 `console.log` → `logger.info` — **effort: XS**

---

## Spec deviations / scope I couldn't reach

- I read ~120 files of the targeted ~200 cap. The merge-conflict file pairs (4 files in T1, 6 in T2) were each diffed/read in full; the 11 new LITFIN packages were each opened to confirm wiring status.
- **Did not deeply inspect** the older session packages' internal correctness — only their consumer-import status. A follow-up audit should walk through each unwired package's `src/index.ts` to determine if the unwired state is intentional (e.g. the package is a CLI-only LITFIN port shipped for reuse) or a wiring gap.
- **Did not run** any tests, builds, or migrations. All findings are static-analysis based.
- **Tier-4 LOW** items were minimally enumerated — there are likely 10-20 more README/JSDoc gaps to surface in a documentation pass.
- **Did not check** RLS policies inside each individual migration (migration 0179_rls_policies.sql was sampled but not exhaustively verified for every tenant-scoped table; the audit doc itself describes the coverage so I trust the migration content).
