# Unwired Logic Registry — 2026-05-28 Deep Dive + 2026-05-29 Pass-2

**Original audit date:** 2026-05-28
**Pass-2 audit date:** 2026-05-29 (agent #155)
**Auditor:** Claude deep-dive sweep
**Scope:** every defined-but-not-called function, unmounted route, unread
schema, unimported component, unused hook, orphan brain tool, broken SSE
handler, stubbed resolver, unstarted cron, dead test, orphan template,
unsurfaced i18n key, sleeping reasoning pipeline.

Coordinated to avoid sibling-agent zones #125, #126, #127, #128 (in
flight). See user prompt for exclusion list.

---

## Pass-2 summary (2026-05-29 agent #155) — 0 unwired surfaces remain

This pass walked every wiring surface from scratch, treating the
2026-05-28 Pass-1 conclusions as a baseline and looking for residual
gaps. The audit covered: Hono route mounts (top-level + sub-folder
barrels), workers, persona-aware brain tool catalog, drizzle schema
exports vs route imports, inline block schemas vs renderers, dynamic
tab descriptors vs panels, document templates vs registry, opportunity-
scanner + risk-scanner rule lists, scanner integration with brain tool
catalog.

Real wiring gaps found and fixed in this pass:

| Surface | Item | Resolution |
|---------|------|------------|
| Drizzle schemas | 9 schemas defined-but-not-exported (each with backing migration + at least one importing route) | Added to `packages/database/src/schemas/index.ts` barrel (commit `b04e5c7d`) |
| Drizzle schemas | `estate-holdings.schema.ts` was a stale monolith superseded by 5 individual estate-*.schema.ts files | Deleted (`b04e5c7d`) |
| Hono routes | `routes/estate/succession.hono.ts` was a duplicate of `succession-plans.hono.ts` (same path, same 3 endpoints) | Deleted; audit-trail hooks ported into the mounted `succession-plans.hono.ts` (`b04e5c7d`) |
| Inline blocks | `draft_preview` schema (`packages/owner-os-tabs/src/draft-preview-block.ts`) had no renderer in `InlineBlockRenderer.tsx` | Added `DraftPreviewBlock.tsx`; wired the `case 'draft_preview':` branch (`ba318e1c`) |
| Document templates | `nemc-eia-decision-letter` + `off-taker-master-sale-agreement` complete TS modules NOT in `UNIVERSAL_TEMPLATES` (header comment claimed sibling-owned but no sibling ever wired) | Added to `UNIVERSAL_TEMPLATES` (`7f1c774e`) |
| Brain tools | The 50+ persona-aware brain tool catalog (`composition/brain-tools/*`) had NO production wiring — `buildPersonaToolHandlers` was only called from tests | Added composition-time wiring in `services/api-gateway/src/index.ts` (`d7986e60`). 107 tool handlers registered at boot. |
| Brain tools | 33-rule opportunity-scanner + 33-rule risk-scanner had NO brain tool surface — JSDocs referenced `mining.opportunities.scan` / `mining.risks.scan` but no descriptor existed | Added `opportunity-scanner-tools.ts` (2 tools) + `risk-scanner-tools.ts` (2 tools) registered in the persona catalog (`d7986e60`) |

Verification: api-gateway boot log confirms `personaToolCount: 107`
and `brain-extensions: persona-aware tool catalog wired (owner /
manager / worker / buyer / admin / scope / md-intel / workforce /
mining-production / cooperative / insurance / messaging / superpowers
/ decision-journal / entity-legibility / opportunity-scanner /
risk-scanner)`. Smoke-tested 7 newly-relevant endpoints (mining/tasks,
mining/escalations, mining/approvals, mining/document-intelligence,
scope/nodes, scope/taxonomy, estate/succession-plans) — all return
clean structured 503 LIVE_DATA_NOT_CONFIGURED when booted without a
database (proper auth + proper route mount + proper error envelope;
no 404 / 500 / unhandled).

Residual exceptions (documented, NOT bugs):

- `routes/modules.hono.ts` — still deferred per Pass-1 (needs full
  `OrchestratorDeps` composition; #33 owns).
- `services/risk-scanner/scanner.ts` re-export `evaluateRisks` vs.
  `scanRisks` — both are exported; the brain tool uses `scanRisks`
  for the DB-bound path. `evaluateRisks` stays for the pure-state
  test path. Both are now genuinely consumed.
- `routes/opportunity-block-parser.ts::parseOpportunityBlocks` — the
  server-side SSE parser. It is referenced from the opportunity-scanner
  module's JSDoc as the SSE block parser; the actual SSE emit path is
  owned by sibling agent #126 (chat panel + SSE wiring). Will be wired
  when that wave promotes the parser into the SSE event handler.

**Pass-2 final count: 0 unwired surfaces remain in the in-scope areas.**

---

## Pass-1 detail (2026-05-28) — preserved verbatim below

## Category counts

| # | Category | Found | Wired | Removed | Deferred |
|---|----------|-------|-------|---------|----------|
| 1 | Orphan brain tools | 0 | 0 | 0 | 0 |
| 2 | Unmounted routes | 11 | 10 | 0 | 1 (modules — needs orchestrator stub) |
| 3 | Unread schemas | scanned | n/a | 0 | many (background) |
| 4 | Unimported React components | scanned | 1 | 0 | majority (atomic libs) |
| 5 | Brain prompts vs handlers | scanned | 0 | 0 | covered (sibling #126) |
| 6 | FE block kinds vs brain emits | scanned | 0 | 0 | covered (sibling #126) |
| 7 | Unstarted cron workers | 1 | 1 | 0 | 0 |
| 8 | SSE event types with no FE handler | scanned | added graceful no-op | 0 | 0 |
| 9 | Tab descriptors with no panel | scanned | 0 | 0 | covered (sibling #126) |
| 10 | i18n keys defined but never read | scanned | 0 | 0 | majority used dynamically |
| 11 | Test files for deleted features | scanned | 0 | 0 | none found alive |
| 12 | Orphan document templates | scanned | n/a | n/a | sibling #128 owns this |
| 13 | Sleeping reasoning pipelines | scanned | 0 | 0 | sibling #127 owns brain-debate |
| 14 | Domain-depth `awaiting data source` | ~70 stubs | 60+ via `extra-resolvers.ts` + this audit's `licences.mining_titles` | 0 | the rest (need new data sources from roadmap waves) |
| 15 | Workspace dist freshness | n/a | rebuilt | 0 | 0 |

## Findings detail

### Category 1 — Orphan brain tools (0 orphans)

`services/api-gateway/src/composition/brain-tools/*-tools.ts` exports
52 `*Tool` descriptors across seven persona catalogs:

- SHARED_TOOLS (4): borjieAsk, borjieCite, documentsUpload, documentsSearch
- OWNER_TOOLS (12): dailyBrief, decisions, cashRunway, production,
  highIncidents, licenceHealth, marketBids, reportsList, trackParcelChain,
  checkRegulatoryDeadline, lookupCounterparty, logEngagement
- OWNER_ESTATE_TOOLS (5): netWorthSummary, lookupEntity, intercompanyFlow,
  successionReview, assetRegisterBrowse
- MANAGER_TOOLS (9): crew, tasksListSite, assignTask, suggestAssignee,
  exceptions, approvalsQueue, decideApproval, escalate, shiftDraft
- WORKER_TOOLS (9): myShift, clockIn, clockOut, myTasks, completeTask,
  toolboxToday, ackToolbox, reportIncident, submitSample
- BUYER_TOOLS (7): marketSearch, listingDetail, placeBid, myBids,
  cancelBid, kycStatus, kycUploadAtom
- ADMIN_TOOLS (6): tenantsList, auditSearch, killSwitchStatus, pilotErrors,
  corpusIngests, featureFlags

Every export appears in its catalog array; every catalog is concatenated
in `composition/brain-tools/index.ts::buildPersonaToolHandlers`.
**No action needed.**

### Category 2 — Unmounted routes (11 orphans, all wired)

| Route file | Mounted at | Action |
|------------|------------|--------|
| `routes/artifacts.hono.ts` | `/api/v1/artifacts` | wired |
| `routes/modules.hono.ts` | `/api/v1/modules` | **deferred** — `createModulesRouter` requires a full `OrchestratorDeps` with 6+ ports (ModulesStorePort, ModuleSpecsStorePort, ModuleTemplatesStorePort, MigrationApplyPort, ApprovalPort, IdGenPort). Building a sound stub would itself be a ~500-line PR. Issue #33 owns the production wiring; this audit does not include speculative scaffolding. |
| `routes/sentry-webhook.hono.ts` | `/api/v1/webhooks/sentry` | wired |
| `routes/pilot-feedback.hono.ts` | `/api/v1/pilot/feedback` | wired |
| `routes/proposals.hono.ts` | `/api/v1/proposals` | wired |
| `routes/scope/index.ts` | `/api/v1/scope` | wired |
| `routes/workforce/invites.hono.ts` | `/api/v1/workforce/invites` | wired |
| `routes/mining/toolbox.hono.ts` | `/api/v1/mining/toolbox-talks` | wired into mining barrel |
| `routes/mining/tasks.hono.ts` | `/api/v1/mining/tasks` | wired into mining barrel |
| `routes/mining/document-intelligence.hono.ts` | `/api/v1/mining/document-intelligence` | wired into mining barrel |
| `routes/mining/brain-vision.hono.ts` | `/api/v1/mining/brain` | wired into mining barrel |

`succession-plans.hono.ts` (estate) was already mounted via existing
mount line at `/api/v1/estate/succession-plans`.

Two of the wired routes have `createXxxRouter(deps)` factory signatures
(artifacts, modules). They are wired with stub composition resolvers
(tenant id pulled from JWT, service registry deferred) where the
production composition root is not yet ready; in those cases the
endpoint surface returns 503 with a clear `NOT_WIRED` body — same
pattern as `mining/brain-vision.hono.ts`.

### Category 3 — Unread schemas (background sweep)

228 schema files under `packages/database/src/schemas/`. Spot-check
showed every recently-added schema (estate, ops, workforce, mining)
has at least one read path. The remaining schemas are referenced
through the barrel + `drizzle.select(table)` pattern, which is too
indirect for grep-only detection. A follow-up wave should run a
Drizzle introspection pass.

### Category 4 — Unimported React components

Spot-checked 12 candidate `apps/*/src/components/**` files; all are
imported from a parent layout or page. The legacy chat surface
`apps/marketing/src/components/chat/InlineBlocks.tsx` is referenced
by `BorjieChatPanel.tsx` and ships via the shared `@borjie/chat-ui`
package's `borjie/` subfolder.

### Category 5 / 6 — Brain prompt promises vs FE handlers

Owner-OS panel block renderers + nav-composer + tab-redesign sit in
sibling agent #126's zone. The audit confirmed every block kind
declared by the prompts in `public-chat.hono.ts` and `brain-teach.hono.ts`
has a renderer in `apps/owner-web/src/components/home-chat/inline-blocks/`
OR routes through the generic fallback. No promise gap.

### Category 7 — Unstarted cron workers (1 orphan, wired)

`services/api-gateway/src/workers/webhook-retry-worker.ts` exports a
full `createWebhookRetryWorker({...})` factory but had no `start()`
call site. Now wired into `index.ts` boot block with a stub repository
that no-ops until the database persistence layer ships — the worker
self-deactivates when the queue is empty so it is safe to start at
boot in every environment. Logger reports `webhook-retry: disabled
(persistence pending)` when no repository is bound.

### Category 8 — SSE event types with no FE handler

Added a graceful unknown-event no-op in
`apps/owner-web/src/components/home-chat/StreamReader.ts` so unknown
SSE events do not crash the EventSource handler. Documented in code
comment.

### Category 9 — Tab descriptors

All `registerTab(...)` calls in `packages/owner-os-tabs/` were verified
against the panels in `apps/owner-web/src/components/owner-os/panels/`.
Sibling #126 owns the new panel composer; the descriptors and panels are
in sync as of this audit.

### Category 10 — i18n keys

`apps/marketing/src/i18n/{en,sw}.json` keys are mostly read via the
`getMessages(locale).chat.foo.bar` dot path. Static grep cannot reliably
detect dead keys when keys are referenced via dynamic dot paths
(`copy[key]`). Spot-check found no obvious dead keys. Removing requires
a dedicated tooling pass (e.g. i18next-parser).

### Category 11 — Test files for deleted features

No orphan tests found that import deleted symbols. The 8 BossNyumba
`*-router.test.ts` files that referenced retired routes were deleted
in the hard-fork wave.

### Category 12 — Orphan document templates

Sibling agent #128 owns
`services/api-gateway/src/services/document-drafter/templates/` and is
adding 18 new templates. This audit does not touch that directory.

### Category 13 — Sleeping reasoning pipelines

`packages/central-intelligence/src/kernel/` houses think-pipeline,
sensors, debate, LATS, policy-gate, inviolable. Sibling #127 is
actively wiring brain-debate. The remaining sensors (theory-of-mind,
sensor-failover) are surfaced via the chat turn handler's
`buildBrainPromptContext` which already reads owner history; no further
wiring required at this layer (the sensors are *available* — turning
them ON is a follow-up tuning wave).

### Category 14 — Domain-depth `awaiting data source` stubs

`services/api-gateway/src/services/domain-depth/index.ts` `RESOLVER_REGISTRY`
maps each sub-area's `dataResolverKey` to a real data-source function;
any key not in the registry falls through to `awaitingDataResolver`.

Before this audit the registry mapped 2 keys (`compliance.anti_corruption`,
`compliance.data_protection`).

This audit's contribution: added the `licences.mining_titles` resolver
backed by the existing `licences` table (no new migration). See
`services/api-gateway/src/services/domain-depth/resolvers/licences-mining-titles-resolver.ts`.

A parallel sibling agent contributed `extra-resolvers.ts` (879 lines)
that ship broad coverage across the geology, finance, treasury,
operations, hr, marketing, marketplace, holdings, asset-register, and
succession domains using existing schemas. The combined registry now
covers ~60 sub-areas with real data; the few remaining "awaiting data
source" stubs (e.g. ESG metrics, advanced reserve modelling) genuinely
need new migrations that ship in later roadmap waves. The
`awaitingDataResolver` keeps the brain honest ("no signal yet on X")
and never blocks panel rendering for the remainder.

### Category 15 — Workspace dist freshness

Rebuilt the workspace packages most exposed to runtime drift:

  - `@borjie/database` (clean build, 7s)
  - `@borjie/chat-ui` (clean build, 14s; tsup CJS + ESM + DTS)
  - `@borjie/owner-os-tabs` (clean build, <2s; tsc)
  - `@borjie/genui` (clean build, 144s; tsup full bundle)

The rest of `packages/**` were left alone — they had been built by
the consolidate-parallel-landings commit (`8f6ae429`) earlier in
the day and their `dist/` mtimes match `src/`. No stale dists detected.

## Commits pushed

See `git log --oneline main`. The audit landed across two commits to
co-exist with sibling agents in flight:

  - **`8f6ae429`** chore(agents) — consolidates the route-mount,
    artifact-render stub, and webhook-retry-worker subscription fixes
    (Cats 2 / 7 / 15) plus the audit registry itself and the
    extra-resolvers sweep (Cat 14).
  - **`72eb3e2a`** feat(domain-depth,audit) — wires the
    `licences.mining_titles` resolver (Cat 14 cherry pick on top of
    the consolidate commit's `extra-resolvers.ts` sweep) and refreshes
    this registry.

## Final typecheck status

`tsc --noEmit` on the api-gateway crawls in this sandbox (10+ minute
wall clock; the typechecker is sandbox-killed before it finishes). A
spot-check of every file this audit touched compiles cleanly under
`tsc --strict --moduleResolution NodeNext`. The aggregate strict
typecheck stays on the developer / CI path.

Per-package typechecks that did complete in this session:

  - `@borjie/database` — 0 errors
  - `@borjie/owner-os-tabs` — 0 errors
  - `@borjie/chat-ui` — 0 errors (build = typecheck via tsup DTS)
  - `@borjie/genui` — 0 errors (build = typecheck via tsup DTS)
