# Wiring Gaps Audit — Borjie — 2026-05-24

**Scope.** Trace 8 critical chains end-to-end (Brain → Routes →
Packages → DB; UI → API → backend; Stores ↔ Usage; Memory cycle;
Realtime; Storage; Advisor → Portal; Workflow → Reviewer → UI).
For each chain: confirm whether the chain is actually wired or just
defined.

**Method.** Static analysis only — read ~120 source files, follow
imports, grep for consumer sites. P32 stalled before producing
output; this is the rerun at reduced scope (8 chains, not 15).
Legend: green = `c.set` proven, partial = constructed-but-not-bound,
disconnected = no consumer at all.

---

## Chain 1: Brain entry → routes → handlers → packages → DB (POST /v1/ask)

**Expected flow:** `POST /api/v1/ask` → `ask.router.ts` → `getAdvisor()`
→ `RoleAwareAdvisor.advise()` (BrainPort + DataPort + AuditPort) →
LLM call (multi-llm-synthesizer) → AuditPort write to WORM table →
JSON response.

**Actual flow:** confirmed via
`services/api-gateway/src/index.ts:797` (`api.route('/ask',
askRouter)`) to
`services/api-gateway/src/routes/ask/ask.router.ts:57` (POST `/`
handler) to
`services/api-gateway/src/routes/ask/advisor-wiring.ts:54-205`
(`getAdvisor()` builds brain via `wireMultiLLMBrain` adapter, data
via `wireUserContextDataPort`, audit via `createPersistentStores().wormAuditStore`)
to `packages/role-aware-advisor/src/orchestrator.ts` (consumer of
those ports) to `packages/database/src/services/worm-audit-log.service.ts`
(persistent audit write — schema `0165_worm_audit_log.sql`).

**Wiring status:** ✅ fully wired (since the advisor-wiring rewrite —
all three ports degrade gracefully to in-memory fallbacks when env
or DB is missing).

**Repair effort:** small (<1h)

**Repair description:** Add a startup log that prints
`{ brain, data, audit }` wiring labels so ops can see at a glance
whether the route is running on real ports or fallbacks. The
`AdvisorWiringStatus` is computed but never logged.

---

## Chain 2: Tenant-portal marketplace UI → /api/v1/marketplace-universal → backend

**Expected flow:** `apps/tenant-portal/src/app/marketplace/listings/page.tsx`
→ `marketplaceClient.searchListings()` →
`GET /api/v1/marketplace-universal/listings` →
`universalMarketplaceRouter` → `MarketplaceDataPort` (seeded
in-memory; Postgres adapter pending 0172 migration).

**Actual flow:** confirmed via
`apps/tenant-portal/src/app/marketplace/listings/page.tsx:28`
(`marketplaceClient.searchListings(filters)`) to
`apps/tenant-portal/src/lib/marketplace/api-client.ts` (fetches
`/api/v1/marketplace-universal/listings`) to
`services/api-gateway/src/index.ts:676`
(`api.route('/marketplace-universal', universalMarketplaceRouter)`)
to
`services/api-gateway/src/routes/marketplace/marketplace.router.ts:48`
(Hono router with `createSeededStore` default data port) backed by
migration `0172_marketplace_universal_tenancy.sql`.

**Wiring status:** 🟡 partial — UI ↔ API ↔ router is fully wired,
BUT the production DataPort is still the **seeded in-memory store**.
No Postgres adapter consumes the `0172` migration. Result: the
listings page renders the in-memory seed data in production.

**Repair effort:** medium (1-4h)

**Repair description:** Implement `createPostgresMarketplaceDataPort`
that reads from the `marketplace_*` tables, then swap the default
`inMemoryDataPort` for it in the composition root when `DATABASE_URL`
is set.

---

## Chain 3: Persistent stores ↔ usage (5 stores)

**Expected flow:** `createPersistentStores({ db })` →
serviceRegistry.persistentStores → `c.set('lessonStore', …)` etc.
in service-context middleware → routes read via `c.get('lessonStore')`.

**Actual flow:** confirmed via
`services/api-gateway/src/composition/persistent-stores-wiring.ts:112`
(`createPersistentStores`) to
`services/api-gateway/src/composition/service-registry.ts:2090`
(`persistentStores: createPersistentStores({ db })`) ... and then
NOTHING. Reading
`services/api-gateway/src/composition/service-context.middleware.ts`
line-by-line shows zero `c.set('lessonStore' | 'wormAuditStore' |
'skillRegistryWriter' | 'aopRegistryStore' | 'a2aTaskStore', …)`
calls.

The only consumer that READS them is the advisor-wiring (which
pulls `wormAuditStore` directly via `createPersistentStores` —
bypassing the registry, which means the WORM is wired but every
route that does `c.get('wormAuditStore')` still gets `undefined`).
`ask.router.ts:230` reads `c.get('lessonStore')` and silently
falls through to a no-op when the get returns `undefined` — which
it always does.

**Wiring status:** ❌ disconnected (4 of 5 stores); ✅ partial for
WORM audit (accessible only via the advisor singleton, not via `c.get`).

**Repair effort:** small (<1h)

**Repair description:** In
`service-context.middleware.ts`, after the existing `c.set('services',
registry)`, add:

```ts
c.set('lessonStore', registry.persistentStores.lessonStore);
c.set('wormAuditStore', registry.persistentStores.wormAuditStore);
c.set('skillRegistryWriter', registry.persistentStores.skillRegistryWriter);
c.set('aopRegistryStore', registry.persistentStores.aopRegistryStore);
// a2a is tenant-pinned — set the factory and let routes call it
c.set('getA2aTaskStore', registry.persistentStores.getA2aTaskStore);
```

This is the SINGLE highest-leverage repair in the audit: 5 stores
go from "constructed and tested in isolation" to "actually read by
the live request path".

---

## Chain 4: Brain memory cycle (autobiography + lessons)

**Expected flow:** Trace from a user turn → `brain-evolution-worker`
nightly pipeline → stage-06 generates autobiography →
stage-04 writes MemoryDelta → next kernel call reads persona core-memory
including the new autobiography → lesson-store fed by feedback
(`ask.router.ts:230` low-rating hook) → `renderLessons()` injects
into the next prompt.

**Actual flow:** confirmed via
`services/brain-evolution-worker/src/pipeline/stage-06-autobiography.ts:1-50`
(generates) → `stage-04-write-memory.ts` (persists MemoryDelta). The
kernel side: `packages/central-intelligence/src/kernel/metacognition/autobiography.ts:107`
exports the pure aggregator but `grep -rn lessonStore packages/central-intelligence/src` returns ZERO
non-test consumers. `packages/ai-copilot/src/reflexion/lesson-renderer.ts`
exports `renderLessons` but ZERO production consumers in
packages/services (it ships, no caller).

**Wiring status:** ❌ disconnected — autobiography is generated and
written, but no kernel code reads it back. Lesson-store is FED by
the feedback endpoint (when low rating) but NEVER CONSULTED on
the next decision.

**Repair effort:** large (>4h)

**Repair description:** Two writes worth ~30 min each, plus a kernel
call-site change worth ~2h: (a) in `kernel/compose.ts` or wherever
the persona prompt is assembled, append a `Recent autobiography:`
section read from the persona core-memory table; (b) in the same
place, call `renderLessons(lessonStore, tenantId, taskTag, { limit:
5 })` and append to the system prompt.

---

## Chain 5: Realtime channels (defined vs subscribed)

**Expected flow:** Server publishes to channels via
`@borjie/realtime-adapter` Supabase backend → portal apps
subscribe via the same adapter or the Supabase JS client.

**Actual flow:** `packages/realtime-adapter/src/supabase.ts:46`
defines `sb.channel(channelName)` for any name. Searching
`grep -rln "from '@borjie/realtime-adapter'" packages services apps`
returns ONLY `packages/realtime-adapter/src/index.ts` and the
package's own package.json. ZERO consumers in
packages/services/apps.

Direct supabase usage exists in `apps/customer-app/src/lib/supabase.ts`,
`apps/estate-manager-app/src/lib/supabase.ts`,
`apps/tenant-portal/src/lib/ask-client.ts` — but only the static
client; `grep -rln "\.channel(\|subscribe("` across apps returns
ONE match (`push-notifications.ts`), not a Supabase realtime call.

**Wiring status:** ❌ disconnected — the adapter exists, nobody
publishes through it, nobody subscribes from it. Live-updates UX is
absent.

**Repair effort:** large (>4h)

**Repair description:** Pick the two flows that benefit most —
work-order status changes (estate-manager-app) and inquiry replies
(tenant-portal) — wrap their POST handlers to publish to
`tenant:{tenantId}:work-orders` and `tenant:{tenantId}:inquiries`
respectively, then add `useRealtimeChannel` hook in the two apps.

---

## Chain 6: Storage buckets (defined vs consumed)

**Expected flow:** `STANDARD_BUCKETS = ['documents','media-photos',
'media-videos','media-audio','reports','avatars','tenant-uploads']`
in `packages/storage-adapter/src/types.ts:18` → upload routes call
`storageAdapter.upload(...)` → bucket gets data → readers call
`storageAdapter.createSignedUrl(...)`.

**Actual flow:** `packages/storage-adapter/src/index.ts` exports a
clean Port + 3 adapters (Supabase, local-disk, in-memory). Searching
`grep -rln "from '@borjie/storage-adapter'"` outside the
package itself returns ZERO consumers.

`grep -rn "storage.from\|createSignedUrl\|upload(" packages services`
turns up only the adapter's own tests + a procurement-coordination
type definition that mentions "storage" as a noun, plus
`api-gateway/src/storage/__tests__/session-replay-storage.test.ts`
which uses a different in-house storage layer.

**Wiring status:** ❌ disconnected — 7 standard buckets defined,
the upload code that actually exists (documents.hono.ts,
inspections, photo upload in marketplace) does NOT route through
the adapter.

**Repair effort:** medium (1-4h)

**Repair description:** Audit every existing upload call-site,
identify the bucket each one should use, and swap raw `supabase.storage`
calls for `storageAdapter.upload({ bucket: ..., path:
tenantScopedPath(tenantId, fileId), ... })`. This also closes a
silent RLS hole — the adapter enforces tenant-scoped paths; raw
calls don't.

---

## Chain 7: AI advisor → portal surface (8 advisor packages → routes → portal UI)

**Expected flow:** 8 advisor packages
(`acquisition`/`expansion`/`lifecycle`/`sustainability`/
`green-angle`/`estate-department`/`stage`/`role-aware`)
each have a router under `services/api-gateway/src/routes/*-advisor.router.ts`
that is mounted in `index.ts`, and a portal page under
`apps/admin-platform-portal/src/app/advisor/*`.

**Actual flow:** confirmed 6 of 8 mounted in
`services/api-gateway/src/index.ts:741-746`
(acquisition, expansion, lifecycle, sustainability, green-angle,
estate-department). Role-aware is mounted as `/api/v1/ask` (line 797).
**Stage-advisor is the 8th — router exists at
`services/api-gateway/src/routes/stage/index.ts:61` but is NEVER
imported into `index.ts` nor mounted.** Portal-side: each of the 8
has a directory under `apps/admin-platform-portal/src/app/advisor/`
including a `stage` (typo? — actually it's named differently per
review of the dir listing).

**Wiring status:** 🟡 partial — 7 of 8 are end-to-end usable;
stage-advisor is the unmounted orphan.

**Repair effort:** small (<1h)

**Repair description:** Import `stageRouter` from
`./routes/stage/index.js`, add
`api.route('/stage-advisor', stageRouter)` alongside the other six
mounts, and add `stageAdvisor` to the `c.set('services', { ... })`
shim in `service-context.middleware.ts` so the router's
`getServices(c).stageAdvisor` resolves.

---

## Chain 8: Workflow + assignments (assignment-registry → workflow-engine → ai-reviewer → routes → UI)

**Expected flow:** `packages/assignment-registry` (`ScopeGuard` +
`IdGen`) → `packages/workflow-engine` (`WorkflowEngine.run()` uses
`aiReviewer.review` + `scopeGuard.check`) →
`packages/ai-reviewer` (10 policies — parcel-edit, photo-add,
inspection, document-upload, polygon-draw, metadata-update,
maintenance-completion, po-approval, etc.) → exposed via a route
in `services/api-gateway` → consumed by
`apps/estate-manager-app/src/app/brain/reviews/page.tsx`.

**Actual flow:** `packages/workflow-engine/src/runs/engine.ts:27`
imports from `@borjie/assignment-registry`,
line 105 takes `aiReviewer: AIReviewerPort`, line 338 calls
`deps.aiReviewer.review({...})`. BUT
`grep -rln "from '@borjie/workflow-engine'" services apps` returns
ZERO matches. `grep -rln "from '@borjie/ai-reviewer'"` also returns
zero. `grep -rln "from '@borjie/assignment-registry'"` returns
only the workflow-engine package itself.
`services/api-gateway/src/routes/workflows.router.ts:17` instead
imports `WorkflowEngine` from `@borjie/ai-copilot` — a
SECOND, simpler workflow engine — with `InMemoryWorkflowRunStore`.
The estate-manager `brain/reviews/page.tsx:43` calls
`/api/brain/review-queue` (not `/api/v1/workflows`) — a Next API
route, NOT the api-gateway workflows route.

**Wiring status:** ❌ disconnected — three packages
(workflow-engine, ai-reviewer, assignment-registry) ship and are
mutually consistent BUT have no consumer in services/apps. The
mounted `/v1/workflows` route uses a different engine in-memory.
The estate-manager review UI talks to its OWN Next.js BFF route,
not to either gateway-mounted engine.

**Repair effort:** large (>4h)

**Repair description:** This is the largest single wiring debt in
the codebase. Two reasonable paths: (a) DELETE the simpler engine
in `@borjie/ai-copilot` and have `/v1/workflows` consume
`@borjie/workflow-engine` with `aiReviewer = createAIReviewer(
{ policies: [...] })` and `scopeGuard = createScopeGuard(
assignmentRegistry)`. (b) Keep both but rename one. Then point the
estate-manager `brain/reviews` UI at the gateway route. Plus: add
a Postgres-backed `WorkflowRunStore` (the in-memory one loses every
run on restart).

---

## Top-15 wiring repairs (sorted by impact × inverse-effort)

| # | Repair | Effort | Impact |
|---|--------|:------:|:------:|
| 1 | `c.set` the 5 persistent stores in service-context middleware (chain 3) | small | critical |
| 2 | Mount `stageRouter` at `/api/v1/stage-advisor` (chain 7) | small | high |
| 3 | Log `AdvisorWiringStatus` at boot so ops can see real vs fallback ports (chain 1) | small | high |
| 4 | Postgres adapter for `MarketplaceDataPort` consuming migration 0172 (chain 2) | medium | high |
| 5 | Route all upload call-sites through `storageAdapter.upload` + `tenantScopedPath` (chain 6) | medium | high |
| 6 | Have kernel `compose.ts` inject `renderLessons(lessonStore, tenant)` into system prompt (chain 4) | medium | high |
| 7 | Have kernel read latest autobiography from persona core-memory on every turn (chain 4) | medium | high |
| 8 | Unify workflow engines — delete or rename the duplicate, wire `aiReviewer` + `scopeGuard` (chain 8) | large | critical |
| 9 | Postgres-backed `WorkflowRunStore` so runs survive restarts (chain 8) | medium | high |
| 10 | Point estate-manager `brain/reviews` UI at the gateway workflows route (chain 8) | small | high |
| 11 | Publish work-order status changes through realtime-adapter, subscribe in estate-manager (chain 5) | medium | medium |
| 12 | Publish inquiry replies through realtime-adapter, subscribe in tenant-portal (chain 5) | medium | medium |
| 13 | Enforce citation-verifier (no advisor answer without ≥1 citation) (sota gap 4) | small | high |
| 14 | Add startup probe for PostGIS extension (sota gap 5) | small | medium |
| 15 | Add cross-tenant leak integration test (sota gap 1) | medium | critical |

---

## Repair clusters (suggested ordering)

**Cluster A — "make what's built reachable" (1 day):** items 1, 2, 3,
10, 13, 14. Mostly `c.set` and route-mount changes, plus one boot
probe. Closes 5 of 8 chains' easy gaps.

**Cluster B — "persistence + production paths" (2-3 days):** items
4, 5, 9. Replaces in-memory adapters / stores with Postgres /
Supabase Storage equivalents for the three flows users see most.

**Cluster C — "brain actually learns" (1 week):** items 6, 7. Kernel
changes plus prompt-assembly tests. Without this, Borjie's
"persistent persona" is an illusion.

**Cluster D — "workflow unification" (1 week):** items 8, 11, 12.
The largest single-package consolidation; ships the real
AI-reviewer + scope-guard surface to the estate-manager review
queue.

---

## Cross-reference

This document pairs with [SOTA_PARITY_AUDIT_2026-05-24.md](./SOTA_PARITY_AUDIT_2026-05-24.md).
The SOTA audit asks "are we using the best available pattern?"; this
document asks "is the pattern we chose actually plugged in?".
