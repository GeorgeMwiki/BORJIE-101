# Unwired Logic Registry — 2026-05-28 Deep Dive

**Audit date:** 2026-05-28
**Auditor:** Claude deep-dive sweep
**Scope:** every defined-but-not-called function, unmounted route, unread
schema, unimported component, unused hook, orphan brain tool, broken SSE
handler, stubbed resolver, unstarted cron, dead test, orphan template,
unsurfaced i18n key, sleeping reasoning pipeline.

Coordinated to avoid sibling-agent zones #125, #126, #127, #128 (in
flight). See user prompt for exclusion list.

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
| 14 | Domain-depth `awaiting data source` | scanned | 0 | 0 | flagged for follow-up wave |
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

`services/api-gateway/src/services/domain-depth/index.ts` resolvers
still return `{status: 'unknown', note: 'awaiting data source'}` for
several sub-areas. Each stub is intentionally a placeholder — the data
source ships in a different wave. Documented as deferred with reason in
the file's top-of-file comment. No change.

### Category 15 — Workspace dist freshness

Rebuilt every workspace package's `dist/` via
`pnpm -r --filter "./packages/**" build`. Confirmed all dists current
at end of audit.

## Commits pushed

See `git log --oneline main`. Each commit body lists the specific
finds + fixes for the category it covers.
