# Final Bug Audit Pass 2 — 2026-05-25

Second-pass audit after the P70 baseline (`cae3740a`) + P71-P74 closure work landed: P71 (CR-1+CR-3), P72 (CR-2+HI-3), P73 (memory-v2+llm-budget-governor wirings), P74 (ocsf-emitter+cross-org-denial-recorder wirings, apollo+sleep-pass infra). HEAD at audit time: `874f07c5`.

This pass surfaces bugs the P70 audit missed and regressions introduced by the closure commits.

## Executive summary
- TIER 1 (CRITICAL): 4 findings — including a production-breaking migration runner regression + a TypeScript test-suite break
- TIER 2 (HIGH): 6 findings — including blocking sync I/O in audit hot-path + composition root size creep + non-persistent budget caps
- TIER 3 (MEDIUM): 5 findings — code smell + stale audit data
- TIER 4 (LOW): 4 findings
- **Total: 19 findings**

> **HEADLINE 1:** P72's migration rename (`0179_rls_policies.sql` → `0179b_rls_policies.sql` + 24 siblings) silently breaks the `drizzle.__drizzle_migrations` hash contract for every existing deployment. The runner keys idempotency by `file.replace('.sql','')` so renamed files get re-applied on next deploy. The renamed SQL is mostly idempotent (DO $$ BEGIN wrappers), but the runner still triggers 25 re-application logs and the journal table ends with duplicate-resource entries.

> **HEADLINE 2:** P72's CR-2 fix restored the binding-first `withSecurityEvents(binding, handler)` signature for production callers, but `packages/observability/src/security/__tests__/with-security-events.test.ts` was never updated. 7 test cases use the legacy handler-first signature — TypeScript compile fine (tests excluded from build) but `pnpm test` for `@borjie/observability` will fail.

---

## Regressions from P71/P72/P73 fixes

| Fix commit | Regression detected? | Notes |
|---|---|---|
| P71 `3b4d8125` — CR-1 persistentStores/documentStorage slot re-add | **No** functional regression; multiLLMSynthesizer slot still missing from registry (file `multi-llm-synthesizer-wiring.ts` exists but no consumer) | Pre-existing gap, not introduced by P71 |
| P71 `dd5b88ff` — CR-3 strategic-reports dep | **No** — workspace symlink resolves; reports.router.ts imports succeed |  |
| P72 `9b6417d6` — CR-2 phantom-exports purge | **Yes (BUG-CR-1 below)** — handler-first API → binding-first API broke 7 test cases in observability's own test file |  |
| P72 `88a7e2bc` — HI-3 25-file migration rename | **Yes (BUG-CR-2 below)** — drizzle migration hash invalidated for every existing deployment; runner re-applies all 25 files; audit report `audit-reports/rls-coverage.json` has 32 stale filename references |  |
| P73 `6be2511a` — memory-v2 wiring | **Partial** — commit message says "replaces single-layer conversation memory" but `centralIntelligence.memory: createInMemoryConversationMemory()` is still on line 1242 + 1923; memory-v2 was added in PARALLEL, not as replacement |  |
| P73 `d3ed36f2` — llm-budget-governor wiring | **No regression**; budget store is in-memory (non-persistent) in BOTH live and degraded mode → caps reset on every gateway restart (flagged as BUG-HI-3 below) |  |

---

## Critical findings

### BUG-CR-1 — `withSecurityEvents` test file uses obsolete handler-first API
- File: `packages/observability/src/security/__tests__/with-security-events.test.ts:53,65,72,82,94,120` (6 lines, 7 test cases)
- Symptom: Calls `withSecurityEvents(async (c) => {...})` and `withSecurityEvents(handler, { skip, onError })`. P72 restored the binding-first signature `withSecurityEvents(binding, handler)`. TypeScript build tolerates this (tests excluded from `packages/observability/tsconfig.json` via `"exclude": ["**/*.test.ts"]`), but `pnpm --filter=@borjie/observability test` fails at compile + runtime.
- Same file: line 161 calls `recordSecurityEvent(ctx, 'DENIED', 'reason')` (3 positional args), but the canonical signature accepts a single binding-shaped object.
- Suggested fix: Rewrite the test cases to the new API:
  ```ts
  const handler = withSecurityEvents(
    { action: 'thing.create', resource: 'thing', severity: 'info' },
    async (c) => { (c.res as { status: number }).status = 201; return { ok: true }; },
  );
  ```
- Confidence: high

### BUG-CR-2 — Migration runner hash invalidated by P72's 25-file rename — every existing deployment re-applies 25 migrations
- File: `packages/database/src/run-migrations.ts:87-104` (the runner keys idempotency by `file.replace('.sql','')`)
- Affected files: 25 renamed migrations (`0017b_gepg.sql`, `0018b_arrears_ledger.sql`, … `0179b_rls_policies.sql`)
- Symptom: On any database that previously applied `0018_arrears_ledger.sql`, the journal table contains hash `0018_arrears_ledger`. After P72, the runner sees `0018b_arrears_ledger.sql`, computes hash `0018b_arrears_ledger`, doesn't find it, re-applies the SQL. Most renamed SQL is wrapped (`CREATE TABLE IF NOT EXISTS`, `DO $$ BEGIN ... DROP POLICY IF EXISTS ... CREATE POLICY ...`) so it succeeds, but:
  1. 25 noisy "Applied X" log lines on every deploy
  2. Journal table ends with both old and new entries (forever)
  3. Any single non-idempotent statement in any of the 25 files crashes the deploy
  4. `audit-reports/rls-coverage.json` has 32 stale `0018_arrears_ledger.sql` / `0164_spatial_parcels.sql` etc. references (audit tooling broken)
- Suggested fix: Ship a one-shot migration `0212_rename_journal_hashes.sql` that does:
  ```sql
  UPDATE drizzle.__drizzle_migrations
    SET hash = REPLACE(hash, '0179_rls_policies', '0179b_rls_policies')
    WHERE hash = '0179_rls_policies';
  -- ... repeat for each of the 25 renames
  ```
  Then regenerate `audit-reports/rls-coverage.json` via `node scripts/audit/check-rls-coverage.mjs`.
- Confidence: high

### BUG-CR-3 — Sleep-pass orchestrator pod is a metrics+health stub; the 8 sleep passes never fire
- Files: `services/sleep-pass-orchestrator/src/index.ts:75-99` + Dockerfile + k8s
- Symptom: The Dockerfile claims "Always-on 60s heartbeat orchestrator that dispatches 8 off-peak sleep passes" but `main()` only starts the Fastify probe server. The actual orchestrator loop (`createOrchestrator + start()`) is deferred to "the api-gateway composition root, which has the Drizzle + Redis adapters in scope" — but `grep -rn "@borjie/sleep-pass-orchestrator\|createOrchestrator" services/api-gateway/src/` returns zero matches. So the pod runs, reports `/healthz` healthy + `/metrics`, but does **nothing**. No DLQ replay, no cache warm-up, no audit-chain verify, no dormant-tenant detection.
- Suggested fix: Either wire `createOrchestrator` from the api-gateway composition root (preferred, since adapters live there), or move the orchestrator boot into `services/sleep-pass-orchestrator/src/index.ts:main()` and inject in-memory adapters as a temporary measure until Drizzle/Redis adapters land in this service.
- Confidence: high

### BUG-CR-4 — `appendFileSync` in OCSF emit path blocks the request event loop
- File: `services/api-gateway/src/composition/ocsf-emitter-wiring.ts:42-52`
- Symptom: Every audit emission (every mutating endpoint) does `appendFileSync(path, line)`. Disk latency stalls the event loop for the entire process — the worst-case behaviour for a Node.js gateway. Comment says "fine for the modest audit volume" but high-traffic webhooks (`/africastalking`, `/twilio`, `/meta`, `/inngest`) all hit `ocsf.emit` in a fire-and-forget path that's still on the request thread.
- Also: lines 19, `openSync, writeSync, closeSync` are imported but never used.
- Suggested fix:
  ```ts
  import { appendFile } from 'node:fs/promises';
  function createFileLineWriter(path: string): LineWriter {
    return {
      async write(line: string): Promise<void> {
        try { await appendFile(path, line, { encoding: 'utf8' }); } catch {}
      },
    };
  }
  ```
  Drop the unused fs imports.
- Confidence: high

---

## High findings

### BUG-HI-1 — Composition root crossed 2300 LOC; `buildServicesInner` is 890 lines
- File: `services/api-gateway/src/composition/service-registry.ts` — 2305 LOC (was 2239 at P70, +66 lines)
- `buildServicesInner()` is 890 lines (CLAUDE.md says functions <50; files <800).
- `degradedRegistry()` is 206 lines.
- Symptom: Maintenance hazard — every new wiring (P73 added memory-v2 + llm-budget-governor; P74 added ocsf + crossOrgDenialRecorder) bloats both functions by 4-6 lines. Approaching the 2500 line ceiling I flagged in P70.
- Suggested fix: Extract per-domain wiring builders (e.g. `buildBrainKernelSlot(input)`, `buildMemoryStackSlot(input)`, `buildSecuritySlots(input)`) so `buildServicesInner` becomes a 200-line composition root that orchestrates 10-15 focused builders. The 9 existing per-domain wiring files (`brain-kernel-wiring.ts`, `persistent-stores-wiring.ts`, etc.) prove the pattern works.
- Confidence: high

### BUG-HI-2 — `centralIntelligence.memory` still wired to single-layer `createInMemoryConversationMemory`; memory-v2 is parallel, not replacement
- File: `services/api-gateway/src/composition/service-registry.ts:1242 + 1923`
- Symptom: P73's commit message says "wire memory-v2 (replaces single-layer conversation memory)" but the diff added a NEW `memoryV2` slot alongside the existing `centralIntelligence.memory`. The streaming agent loop still consumes the old single-layer memory; memory-v2 has no consumer beyond the registry slot.
- Suggested fix: Either (a) flip `centralIntelligence.memory: memoryV2.stores.episodic` (or a memory-v2-backed `ConversationMemory` adapter), or (b) update P73's commit message + add a follow-up tracking the cutover. The current state is dead code in production until a consumer reads `registry.memoryV2`.
- Confidence: high

### BUG-HI-3 — LLM budget governor uses in-memory store in LIVE mode; caps reset on every gateway restart
- File: `services/api-gateway/src/composition/service-registry.ts:1831-1833` (live path)
- Symptom: `createInMemoryBudgetStore()` is wired in BOTH degraded mode (l.1170) AND live mode (l.1832). Budget usage state lives in the api-gateway process heap. On restart (deploy, OOM kill, scale-down), every tenant's daily budget resets to zero — they get unlimited LLM spend until the in-memory counter rebuilds. The cap promise is broken across restarts.
- Comment at l.1827 acknowledges "Live mode uses the in-memory store until the Postgres adapter ships (follow-up)."
- Suggested fix: At minimum, fail-fast at boot if `NODE_ENV === 'production'` and no persistent budget store is available. Long-term: ship a Drizzle adapter (`packages/llm-budget-governor/src/budget-store/store-drizzle.ts`) backed by `llm_budget_usage` table.
- Confidence: high

### BUG-HI-4 — `console.warn` in production composition path (live llmRouter build)
- File: `services/api-gateway/src/composition/service-registry.ts:1561-1565`
- Symptom: `buildMultiLLMRouterFromEnv` failures fall through to `console.warn(...)`. CLAUDE.md says "No `console.log` in services. Pino logger only — it handles redaction." Bypasses PII redaction. Same pattern in `services/apollo-gauntlet-runner/src/index.ts:82,90,98,105,132` (CronJob batch — slightly more tolerable since it's not on the request path).
- Suggested fix: Replace with `logger.warn({ err }, 'service-registry: ...')`. Apollo's stdout/stderr is structured-log-readable in K8s so leave it, but mark with explicit no-pino justification.
- Confidence: high

### BUG-HI-5 — `invokedDirectly` check broken on paths with spaces (new services)
- Files: `services/apollo-gauntlet-runner/src/index.ts:119-127`, `services/sleep-pass-orchestrator/src/index.ts:101-109`
- Symptom: Both use `new URL(\`file://${process.argv[1]}\`).href` which does NOT percent-encode spaces. If `process.argv[1]` contains a space (local dev paths often do; rare in K8s), the URL constructor either throws or produces a mismatched href → main() never fires → pod boots a service that does nothing.
- Same bug pattern was already fixed in `packages/database/src/run-migrations.ts:120-136` which routes both through `pathToFileURL` exactly to handle this case.
- Suggested fix: Copy the `run-migrations.ts:isCliEntry` pattern:
  ```ts
  import { pathToFileURL } from 'url';
  const invokedDirectly = (() => {
    try {
      const entry = process.argv[1];
      if (typeof entry !== 'string' || entry.length === 0) return false;
      return import.meta.url === pathToFileURL(entry).href;
    } catch { return false; }
  })();
  ```
- Confidence: high

### BUG-HI-6 — Sleep-pass orchestrator standalone main() swallows promise rejection
- File: `services/sleep-pass-orchestrator/src/index.ts:111-113`
- Symptom: `void main();` — if buildApp() or anything in main() throws BEFORE the inner try/catch around `app.listen`, the rejection becomes an UnhandledPromiseRejection. Apollo handles this correctly: `void main().catch((err) => { console.error(...); process.exit(1); })`.
- Suggested fix: Match Apollo's pattern.
- Confidence: high

---

## Medium findings

### BUG-ME-1 — `audit-reports/rls-coverage.json` has 32 stale migration filenames
- File: `audit-reports/rls-coverage.json` — 32 references to `0017_inspections_extensions.sql`, `0018_arrears_ledger.sql`, `0018_conditional_surveys.sql`, `0018_marketplace.sql`, `0164_spatial_parcels.sql` (all renamed by P72).
- Symptom: Any tooling that joins this report to current migration filenames produces "missing file" warnings or incorrect coverage attribution.
- Suggested fix: Re-run `node scripts/audit/check-rls-coverage.mjs` and commit the regenerated report.
- Confidence: high

### BUG-ME-2 — Schema-file JSDoc references stale migration filenames
- Files: `packages/database/src/schemas/{parcels,buildings,elements,payments-ledger}.schema.ts`
- Symptom: Schema-file headers carry `* Drizzle definitions mirroring migration 0164_spatial_parcels.sql.` etc. — file no longer exists at that path. Misleads engineers who grep for the source migration.
- Suggested fix: Search-and-replace the 4 stale references with their `*b/*c/*d` equivalents.
- Confidence: high

### BUG-ME-3 — `Docs/KNOWN_ISSUES.md` runbook references files that no longer exist
- File: `Docs/KNOWN_ISSUES.md:44-45` references `0018_tenant_finance.sql` and `0020_tenant_risk_reports.sql`. Both renamed by P72.
- Symptom: Operators following the runbook hit `cannot open '...': No such file or directory`.
- Suggested fix: Update the runbook to the renamed paths.
- Confidence: high

### BUG-ME-4 — `cross-org-denial-recorder` bucket key omits sourceTenantId — same actor across tenants shares rate-limit slot
- File: `packages/cross-org-denial-recorder/src/recorder.ts:36-38`
- Symptom: `bucketKey = \`${actorUserId ?? "anon"}::${targetTenantId}\``. If a user with the same userId exists in two source tenants (rare on BORJIE but possible with platform-admin or shared-SSO scenarios), they share a rate-limit slot. The full cross-org isolation key should be `actorTenantId::actorUserId::targetTenantId`.
- Suggested fix: `\`${input.actorTenantId ?? "_"}::${input.actorUserId ?? "anon"}::${input.targetTenantId}\``.
- Confidence: medium

### BUG-ME-5 — `multi-llm-synthesizer-wiring.ts` exists with full code but has no consumer
- File: `services/api-gateway/src/composition/multi-llm-synthesizer-wiring.ts:204` (`createMultiLLMSynthesizerWiring`)
- Symptom: P70 audit BUG-CR-1 listed `multiLLMSynthesizer` as a dropped slot; P71 only restored `persistentStores` + `documentStorage`. The wiring file is intact but no slot was added to `ServiceRegistry`, no callsite exists. Dead code.
- Suggested fix: Either restore the slot + caller (probably `brain-kernel-wiring.ts:472` which has the `synthesizer?: MultiLLMSynthesizerPort` field), or delete the wiring file.
- Confidence: high

---

## Low findings

### BUG-LO-1 — 11 LITFIN-port packages still have no README (regression from P70 BUG-LO-1, not fixed)
- Files: `packages/{audit-hash-chain,memory-tool-wire-adapter,ocsf-emitter,mcp-cost-persistence,probe-runners,property-voices-debate,cross-org-denial-recorder,conformal-calibration-online,memory-v2,llm-budget-governor,fairness-eval}/README.md` — all missing.

### BUG-LO-2 — Multiple stale local `claude/*` branches (28+)
- Symptom: `git branch -a` shows 28+ feature branches from earlier waves still alive locally (`claude/am1-httponly-cookie-auth-migration`, `claude/am2-...`, `claude/am3-...`, etc.).
- Suggested fix: After confirming merged-to-main, prune with `git branch -d <branch>` or push-then-archive.

### BUG-LO-3 — `pnpm-lock.yaml` swap of vitest variant (existing → no-coverage variant)
- File: `pnpm-lock.yaml:1092,3153` — vitest version line lost the `(@vitest/coverage-v8@4.1.6)` qualifier. Two importers (root `packages/chat-ui`, `services/apollo-gauntlet-runner`) now resolve to the variant without coverage-v8 peer.
- Symptom: `pnpm test --coverage` may pick up a different vitest binary than `pnpm test`.
- Suggested fix: Run `pnpm install` to normalize. If intentional, document in a code comment.

### BUG-LO-4 — `services/apollo-gauntlet-runner/src/index.ts:48,75,82` use `console.log`/`console.warn`/`console.error`
- File: `services/apollo-gauntlet-runner/src/index.ts:48,75,82,90,98,105,132` — 7 `console.*` calls. CronJob batch so they end up in pod stdout/stderr; not unreasonable, but inconsistent with the codebase's "pino-only in services" rule.

---

## Wiring status (post-P73 + P74)

| Package | Wired? | Consumer file | Notes |
|---|---|---|---|
| audit-hash-chain | NO | — | No wiring. Spec calls for WORM audit-chain verifier cron |
| memory-tool-wire-adapter | NO | — | No wiring. Spec calls for Anthropic Memory tool path |
| ocsf-emitter | **YES** | `services/api-gateway/src/composition/ocsf-emitter-wiring.ts` + `service-registry.ts:735,1229,1906` | But `appendFileSync` (BUG-CR-4) |
| mcp-cost-persistence | NO | — | Needs wiring into mcp-server gateway |
| probe-runners | NO | — | Needs wiring into eval CI gate (`.github/workflows/`) |
| property-voices-debate | NO | — | Needs wiring into ai-copilot debate route |
| cross-org-denial-recorder | **YES** | `services/api-gateway/src/composition/cross-org-denial-recorder-wiring.ts` + `tenant-context.middleware.ts:732-770` | Bucket-key minor issue (BUG-ME-4) |
| conformal-calibration-online | NO | — | Needs wiring into forecasting predict path |
| memory-v2 | **YES (parallel)** | `service-registry.ts:1226,1905` | Slot only; no consumer reads it (BUG-HI-2) |
| llm-budget-governor | **YES** | `service-registry.ts:1169,1831` | In-memory store in live mode (BUG-HI-3) |
| fairness-eval | NO | — | Needs wiring into authz-policy + ai-copilot risk decision path |
| apollo-gauntlet-runner | partial | Dockerfile + K8s CronJob ✓; spawned manually via `APOLLO_AGENT_URL` | Library exports unwired in api-gateway |
| sleep-pass-orchestrator | **broken** | Dockerfile + K8s Deployment ✓; orchestrator loop never starts (BUG-CR-3) | Pod runs as health-only stub |

**Wired: 4 (ocsf-emitter, cross-org-denial-recorder, memory-v2 slot-only, llm-budget-governor with caveats)**
**Unwired: 7 (audit-hash-chain, memory-tool-wire-adapter, mcp-cost-persistence, probe-runners, property-voices-debate, conformal-calibration-online, fairness-eval)**
**Broken: 1 (sleep-pass-orchestrator)**

---

## Top 10 recommended next-wave fixes (prioritized)

1. **BUG-CR-2** — Backfill `drizzle.__drizzle_migrations` for the 25 renamed files, OR rename them back. **Effort: M** (one new migration that runs `UPDATE drizzle.__drizzle_migrations SET hash = …`). Without this, every existing prod deploy re-runs 25 migrations on next boot.
2. **BUG-CR-4** — Switch OCSF `appendFileSync` → `appendFile` async. **Effort: XS** (4-line edit). High traffic webhooks currently block the event loop on each audit emit.
3. **BUG-CR-1** — Rewrite `with-security-events.test.ts` to binding-first API. **Effort: S** (15 min — 7 test cases, mechanical rewrite). Restores `@borjie/observability` test suite.
4. **BUG-CR-3** — Wire sleep-pass orchestrator loop from api-gateway composition root. **Effort: M** (1-2 hrs). Currently the pod runs as a no-op.
5. **BUG-HI-3** — Add boot-time check: production + in-memory budget store = fail-fast OR seed-warning. **Effort: XS** (5-line guard). Long-term: ship Drizzle adapter.
6. **BUG-HI-2** — Decide on memory-v2 cutover plan: either flip `centralIntelligence.memory` to memory-v2-backed, or update P73 commit-msg lore + open a tracking issue. **Effort: S**.
7. **BUG-ME-1 + BUG-ME-2 + BUG-ME-3** — Bulk-update stale migration filenames: regen rls-coverage.json, search-replace 4 schema-file JSDoc strings, fix KNOWN_ISSUES.md runbook. **Effort: S** (~30 min).
8. **BUG-HI-5 + BUG-HI-6** — Fix `invokedDirectly` + `void main()` in both apollo + sleep-pass. **Effort: XS** (copy `run-migrations.ts` pattern).
9. **BUG-HI-1** — Extract per-domain wiring builders from `buildServicesInner` (890 LOC). **Effort: L** (full-day refactor — but blocks future maintainability).
10. **BUG-ME-5** — Either wire `multiLLMSynthesizer` slot or delete `multi-llm-synthesizer-wiring.ts`. **Effort: S** (decision + 30-line code change either way).

---

## Spec deviations / scope I couldn't reach

- **HEAD moved during audit window**: When I started, HEAD was `d3ed36f2` (P73). By the time I was mid-audit, P74's three commits had landed (`b09c4896`, `24459691`, `874f07c5`). The audit covers all of them.
- **Did not audit**: dynamic-loader patterns inside the LITFIN package internals beyond their stores (e.g., I didn't read every cell of `packages/memory-v2/src/narrative/`, `packages/property-voices-debate/src/debate.ts`, etc.). Confidence based on file-level inspection of stores + index files.
- **Did not run**: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`. All findings are static-analysis based.
- **Did not deeply inspect**: k8s manifests for apollo-gauntlet-runner / sleep-pass-orchestrator (NetworkPolicy, RBAC, secret refs). Dockerfile shape was audited.
- **Coverage of P70's HIGH/MEDIUM/LOW findings**: P70's BUG-HI-4 (JWT_AUDIENCE fallback) + BUG-HI-5 (PLATFORM_FEE default) + BUG-HI-6 (Number-typed currency in document-analysis) + BUG-HI-7 (parseFloat in approval-matrix-dsl) — all CONFIRMED still unfixed; not re-listed as new findings here since P70 already enumerated them. They remain valid backlog items.
- **Did not enumerate**: TIER 4 LOW-priority docs gaps beyond the 11 missing READMEs and 28+ stale branches. There are likely 10-20 more doc-drift items.

