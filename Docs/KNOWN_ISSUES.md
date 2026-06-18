# Known Issues

Running log of surfaced bugs that were not fixed inline because they
exceed a ~1-hour scope (cross-package refactors, schema migrations that
need coordinated rollout, infra config, etc.). Each entry includes
precise `file:line`, reproduction steps, root cause, and proposed fix.

Fixes marked inline in `git log` are NOT listed here.

**Open KI count: 0.** All twelve 2026-06-14 Mode-C-review KIs (KI-005…KI-016)
were driven to zero on branch `fix/mode-c-review-drive-to-zero` — each fixed,
guarded, and cold-verified. Entries are kept below as the record, prefixed
**[CLOSED]**.

Two carry a residual that is a deliberate posture, NOT an open bug:
- **KI-005** — the streaming-Auditor is WIRED (the `/chat` orchestrator now
  surfaces an `auditor` SSE verdict after the final answer in both paths, the
  owner-web client consumes it onto `ChatMessage.grounding`, tests red→green).
  The only remnant is the optional grounding-**badge JSX** in `ChatPanel.tsx`
  (a renderer over the now-present `grounding` data — trivial, deferred to a UI
  polish pass). Surface-not-withhold was the chosen model (streamed tokens
  can't be un-sent).
- **KI-010** — the born-dark cron is composed + leader-gated + tested behind a
  **default-OFF** `BORJIE_SELF_EXTENSION_CRON_ENABLED` flag, propose-only
  (four-eye/HITL gated, fail-closed registry). Flipping the flag to allow
  autonomous gap-detection → proposal generation is an ⛔ owner choice, not a
  bug. See the [CLOSED] KI-010 entry for the recipe.

The "cover-all" session drove the full set to zero: KI-005 (chat streaming-
Auditor), KI-006/007 (buyer cross-tenant inquiry loop), KI-008/009 (server↔
mobile tab-kind lockstep + project-on-spawn), KI-010 (self-extension governed
default-OFF), KI-011 (persona-drift `/events` route), KI-012 (field-capture
honest pending-analysis), KI-013 (marketing `/contact`+`/subscribe` sinks,
migration 0359), KI-014 (geofencing predicate un-darkened, migration 0360),
KI-015 (marketing + admin-web vitest configs — dark web-app tests now run,
0 quarantines), KI-016 (cleanups).

Items previously listed as open have been either:
- **CLOSED** — real fix shipped on `main`. Trailer below.
- **MOVED TO ROADMAP** — deferred behind a wave-scale effort; see
  `Docs/ROADMAP.md` for the corresponding `R*` entry.

---

## Open entries (2026-06-14 Mode-C review residue)

### KI-005 — Mining `/chat` SSE bypasses the evidence-chain Auditor — **[CLOSED 2026-06-14] was OPEN — HIGH**

`services/api-gateway/src/routes/mining/chat.hono.ts` (whole file) +
`chat-orchestrator.ts:446-472,561-579`. **Repro:** ask the owner cockpit
chat anything that yields a low/empty-evidence answer; it streams with a
calibrated `confidence` but ZERO grounding/Auditor signal — an ungrounded
answer ships looking authoritative. **Root cause:** chat.hono.ts runs the
ingress/egress guards but never calls `auditChatResponse` /
`decideStrictResponse` (grep of `routes/mining` = zero refs); the
orchestrator emits `message_chunk` with `evidence_ids:merged` + confidence
but no auditor verdict. The non-stream `brain.hono.ts /turn` path DOES
audit + withhold; the streaming path was never wired. **Proposed fix:**
after computing `merged` in both emit paths, call `auditChatResponse({…})`;
add an `auditor` variant to the `ChatSseEvent` union
(`chat-orchestrator.ts:144`) carrying `{verdict,evidenceCount,
evidenceWarning,groundingFault}`; yield it after the final `message_chunk`
(streamed tokens can't be un-sent → surface-not-withhold). The owner-web
chat client must consume it (the `T_auditor` i18n + `brain-api.ts` withhold
UI exist to mirror). **DESIGN NOTE (why registered, not inline):** the
streaming enforcement model — surface-only vs delayed-withhold-of-the-final-
block — is an owner/design decision; primary chat surface, do not ship
half-baked.

### KI-006 — Cross-tenant marketplace bid dead-end — **[CLOSED 2026-06-14] was OPEN — HIGH (model decision)**

`services/api-gateway/src/routes/mining/bids.hono.ts:82-100,132` +
`marketplace.hono.ts:35-53`. **Repro:** buyer browses a listing from
another mine (the cross-tenant marketplace shows them, migration 0350
public-read), opens it, fills PlaceBidSheet, Submit → 404 'Listing not
found' → 'Bid could not be placed' toast. **Root cause:** the marketplace
READ is cross-tenant but place-bid requires the listing in the buyer's OWN
tenant and stamps the bid with the buyer's tenant — bids are structurally
intra-tenant, so a buyer can SEE but not BID on cross-tenant listings.
**Proposed fix — DECISION REQUIRED:** (a) make place-bid look the listing
up cross-tenant (same BUYER_VISIBLE guard as the read) + stamp buyer-tenant
& seller-tenant separately; or (b) keep bids intra-tenant and, on
cross-tenant listings, hide the bid CTA + route to the INQUIRY flow (POST
`/api/v1/mining/flows/inquiries` — the built cross-tenant mechanism, KI-007).
Recommend (b) as the honest interim (cross-tenant bidding isn't built).

### KI-007 — Buyer-mobile has no inquiry consumer / no 'raise inquiry' entry — **[CLOSED 2026-06-14] was OPEN — HIGH (feature)**

`apps/buyer-mobile` (no caller) vs gateway `index.ts:2681` (`/buyer/tabs`),
`:2682` (`/buyer/inquiries`), `routes/mining/flows/inquiry-flow.hono.ts:154`
(POST inquiries). **Repro:** the backend buyer-projection + inquiry
endpoints are mounted + built; grep `apps/buyer-mobile/src` for
`buyer/tabs|/buyer/inquiries|raiseInquiry` = ZERO — a buyer can never raise
an inquiry or see a projected tab. **Root cause:** the buyer leg of the
surface-completion loop was never built on the mobile client. **Proposed
fix:** add a buyer-mobile inquiry client (POST flows/inquiries, GET
/buyer/inquiries), an 'Ask the seller' CTA on `app/marketplace/[id].tsx`, an
inquiries list screen, and a `/buyer/tabs` projection consumer in
`app/(tabs)/_layout.tsx` (mirror workforce `useWorkforceTabConfig`).

### KI-008 — workforce-mobile drops 6/7 owner-spawnable projected tab kinds — **[CLOSED 2026-06-14] was OPEN — MEDIUM**

`services/api-gateway/src/routes/workforce/tab-projection.ts:61-71` (7
kinds) vs `apps/workforce-mobile/src/lib/workforce-tab-projection.ts:41-43`
(maps only `marketplace`). **Root cause:** the mobile screen-map is out of
lockstep with the server allowlist; `resolveProjectedTabs` routes the other
6 kinds into `skippedKinds` → silently dropped. **Proposed fix:** keep the
allowlist + screen-map in lockstep — add screens for `inquiry_respond`/
compliance/safety/reports/treasury/procurement, OR (interim) narrow the
SERVER allowlist to the kinds mobile renders so the owner isn't promised
materialization the worker drops.

### KI-009 — Surface-completion projection bags written only by the golden flow — **[CLOSED 2026-06-14] was OPEN — MEDIUM (architectural)**

`services/api-gateway/src/composition/surface-completion/flow-binder.ts:135-136`
(only `GOLDEN_INQUIRY_FLOW` writes `workforceProjection`/`buyerProjection`);
`services/api-gateway/src/services/action-executor/handlers/tabs.ts:191`
(`spawnTab` persists config verbatim, never injects a projection bag).
**Root cause:** a general owner-spawned tab orphans its complementary
worker/buyer legs by construction — only the one hard-coded golden flow
completes (violates the completion law). **Proposed fix:** in `spawnTab()`,
when config lacks `workforceProjection` and the resolved kind ∈
`PROJECTABLE_TAB_KINDS`, derive + inject `config.workforceProjection={kind}`
(+ `buyerProjection` where applicable) so EVERY spawned capability completes
its multi-surface legs. Account for the `owner_tabs_structural` table split.

### KI-010 — self-extension-cron born-dark — **[CLOSED 2026-06-14] born-dark defect fixed; autonomous-enable still ⛔ owner-gated**

`services/api-gateway/src/composition/self-extension-cron.ts:359`
(`createSelfExtensionCron`) — WAS ZERO non-test importers; not in `index.ts`,
not in `CLUSTER_LEADER_CRON_NAMES`, never `.start()`'d. **Root cause:** the
self-developing-MD keystone had no autonomous driver wired.

**Fix (2026-06-14):** the born-dark *composition* defect is closed WITHOUT
enabling autonomous self-modification. New composition helper
`services/api-gateway/src/composition/self-extension-cron-wiring.ts`
(`buildSelfExtensionCronDeps`) composes the full propose-only dep bundle
(`fourEye` → the single `enqueueFourEyeRequest` path; `selfBuild` →
`createSelfBuildWiring` propose-only dry-run; `subMdRegistry` → **fail-closed**:
`list()`→`[]`, `register()` THROWS so the runtime-apply path stays UNMOUNTED;
`llmRouter` → a deterministic diagnosis-derived `read`-tier spec, no model id).
`index.ts` now constructs the cron UNCONDITIONALLY in the leader-gated
db-present block, adds `'self-extension'` to `CLUSTER_LEADER_CRON_NAMES`, and
leader-gates its `.start()` — but the cron's `enabled` is bound to the
default-OFF `BORJIE_SELF_EXTENSION_CRON_ENABLED` flag, so `.start()` is a
no-op until an owner flips it. A boot-proof structured log is emitted either
way. The terminal action is ALWAYS a four-eye/HITL PENDING proposal — nothing
auto-deploys. Tests: `self-extension-cron-wiring.test.ts` (6, incl. a
red-proven fail-closed `register()` assertion) + the pre-existing
`self-extension-cron.test.ts` (6). **⛔ STILL OWNER-GATED:** flipping
`BORJIE_SELF_EXTENSION_CRON_ENABLED=true` turns on autonomous gap-detection →
proposal generation; do NOT enable in any environment without explicit owner
authorization + the four-eye/HITL governance verified live. Even when enabled
it only PROPOSES; the runtime-apply / sub-MD activation path remains a
separate, maximally-governed wave.

### KI-011 — persona-drift-cron born-dark + no `/events` read route — **[CLOSED 2026-06-14] was OPEN — MEDIUM**

`services/api-gateway/src/composition/persona-drift-cron.ts:117`
(`createPersonaDriftCron`, zero importers, never started); `apps/admin-web`
persona-drift screen calls `/api/v1/persona-drift/events` which the gateway
never mounts (only the cron) → permanent 'Could not load' alert. **Root
cause:** cadence drift detection never runs (only inline post-think), and
the admin read route was never added. **Proposed fix:** construct
`createPersonaDriftCron` in the leader-gated supervisor block
(sampleSource=`cot_reservoir`, assess=`assessPersonaDrift`,
sink=`PersonaDriftSink`) + add a gateway `GET /persona-drift/events`
returning the persisted `kernel_persona_drift_events`. Lower-risk than
KI-010 (detection only, no self-modification).

### KI-012 — Field-capture stub AI inference rendered as live data — **[CLOSED 2026-06-14] was OPEN — MEDIUM**

`services/field-capture-service` — the deterministic STUB inference is
wired as live `processed` data (every photo gets fabricated values). **Root
cause:** a stub stands in for real inference but renders as real (violates
no-mock production-real). **Proposed fix:** wire real inference OR mark the
output honestly (a 'pending analysis'/'demo' state) so fabricated values
never render as live.

### KI-013 — Marketing `/contact` + `/subscribe` gateway routes + tables missing (BE leg) — **[CLOSED 2026-06-14] was OPEN — MEDIUM**

`apps/marketing/src/app/api/{contact,subscribe}/route.ts` forward to
`${GATEWAY}/api/v1/marketing/{contact,subscribe}`;
`services/api-gateway/src/routes/marketing.hono.ts` mounts only
`/pilot-application`. **Repro:** submit the contact/subscribe form → the FE
handler 303-redirects with `?…=error` because the gateway route 503s. The
FE 404 was fixed inline (dbe46cd3); the delivery leg is not built. **Root
cause:** the gateway routes + persistence tables were never created.
**Proposed fix:** mirror `/pilot-application` + migration 0146 — add
`marketing_contact_submissions` + `marketing_subscriptions` tables
(migration 0358) + the two routes persisting to them.

### KI-014 — geofencing predicate service RLS-dark from the worker (0357 residual) — **[CLOSED 2026-06-14] was OPEN — MEDIUM**

`services/api-gateway/src/services/geofencing/predicates.ts:99,142,182,224,261`
(hazard/site/distance queries on a non-context-bound db). **Root cause:**
migration 0357 + the geofence-watcher wrap un-darkened the
`workforce_locations` scan, but the downstream geofencing predicate service
runs its own queries on an uncontextualized handle → still 0 rows under
FORCE RLS when invoked from the worker, so geofence ALERTS are not fully
restored. **Proposed fix:** run the predicate queries under service-role (or
per-tenant) context when invoked from the worker, OR add bypass policies for
the hazard/site tables + bind context in the predicate service.
(Request-path invocations are fine — they carry the tenant GUC.)

### KI-015 — App-level vitest tests excluded by the root config — **[CLOSED 2026-06-14] was OPEN — MEDIUM (CI/meta)**

`vitest.config.ts` include = `packages/** services/** scripts/**` — EXCLUDES
`apps/**`; each app's `test` script runs `vitest run --passWithNoTests`
against that root config. **Root cause:** app-level guards (the new
marketing dead-links test, etc.) + any pre-existing app tests never run in
CI — a false-green coverage gap. **Proposed fix:** add `apps/**/*.test.{ts,
tsx}` to the root vitest include, OR give each app its own
`vitest.config.ts` (owner-web already has one — which is why its
no-bare-fetch guard DOES run). **Caution:** flipping it may surface
pre-existing app-test debt — triage before enabling.

### KI-016 — Minor cleanups (batch) — **[CLOSED 2026-06-14] was OPEN — LOW**

- admin `/platform/overview` StaffNav link + BFF target a gateway route
  removed in the hard-fork (`index.ts:3215`) → 'Active tenants' KPI
  permanently em-dash; remove the dead link or re-point at a live source.
- marketing 4 orphan audience pages (`for-bank`, `for-buyer` [dup of
  `/buyers`], `for-csr-community`, `for-family-office`) — add nav/sitemap
  links or delete.
- `services/api-gateway/.../mounted-routers.ts` dead catalog (docstring
  claims source-of-truth but nothing consumes it) — delete or wire.
- marketing status page fabricates 100% uptime when `DATABASE_URL` unset —
  make it an honest degrade.

---

## Closed entries (trailer)

### KI-001 — Drizzle migration ledger drift in local dev DB — **CLOSED 2026-05-29 — 610f23e7**

**Severity at time of closure:** MEDIUM (local-dev only).

**Fix shipped.** `scripts/verify-migrations.ts` detects ledger drift by
parsing every `*.sql` migration's CREATE TABLE / INDEX / TYPE statements
and probing `information_schema` / `pg_indexes` / `pg_type` for each
hash recorded as applied in `drizzle.__drizzle_migrations`. The CLI
exits non-zero on drift so CI catches it before staging promotion.
Wired into the monorepo via two new package scripts:

```bash
pnpm verify:migrations           # human-readable report
pnpm verify:migrations:json      # JSON for CI ingestion
```

29-case unit test suite (`scripts/__tests__/verify-migrations.test.ts`)
covers regex extractors, drift detection, CLI args, and JSON rendering.

### KI-002 — OpenAPI catalog drift between `export-openapi.mjs` and live routers — **CLOSED 2026-05-29 — dbe5db12**

**Severity at time of closure:** LOW (docs-only).

**Fix shipped.** `services/api-gateway/package.json` swaps
`openapi:export` from the hand-written
`scripts/export-openapi.mjs` to `tsx src/openapi/export-cli.ts` —
the route-harvester CLI that walks the real Hono `.routes` table via
`route-harvester.ts` + `schema-registry.ts`. The hand-rolled .mjs
remains accessible as `openapi:export:legacy` so a regulator who
needs the historical catalog shape can still emit it. The
`Docs/api/openapi.generated.json` has been regenerated against the
live router graph (1916 insertions / 4206 deletions in the diff —
removes drifted paths, adds harvested ones). One ergonomic fix to
the CLI: the dev-only `JWT_SECRET` env now satisfies the ≥32 char
length check so the CLI never fights the auth-middleware import
chain on first run.

### KI-003 — 40+ routers call service methods without null guards — **CLOSED 2026-05-29 — f8ccddbb**

**Severity at time of closure:** LOW in prod, MEDIUM in sandbox demos.

**Fix shipped.** New
`services/api-gateway/src/middleware/require-service.ts` exports a
Hono middleware factory `requireService(key | keys[])` that short-
circuits to a structured `SERVICE_UNAVAILABLE` 503 envelope when any
required service is not bound on the context. Supports both the
legacy per-key shape (`c.get('renewalService')`) and the
`c.get('services').xxxService` bag shape. Companion `hasService()`
predicate for handlers that prefer to serve a degraded payload
instead of 503ing.

9 vitest cases cover single-key, multi-key, bag-binding, direct-
binding, and the `hasService` predicate path. Routers adopt the
middleware incrementally — the factory is a drop-in `app.use(...)`
guard; per-route adoption tracked under per-domain backlogs.

### KI-004 — MCP `relation "maintenance_cases" does not exist` — **CLOSED 2026-05-29 — a1e2532b** (docs-only; code fix landed in an earlier hard-fork sweep)

**Severity at time of closure:** LOW (hard-fork artifact).

**Fix shipped.** The MCP tool `list_maintenance_cases` in
`services/api-gateway/src/composition/mcp-wiring.ts:209` was already
rewritten to query the canonical `cases` table filtered to
`case_type IN ('maintenance_dispute','damage_claim')`. The hard-
forked `maintenance_cases` table no longer exists and its old MCP
binding has been replaced. Verified the MCP tool returns structured
JSON on a clean local DB.

### KI-012 — M-Pesa webhook idempotency cache is process-local — **CLOSED 2026-05-29 — 3938657d**

**Severity at time of closure:** MEDIUM (multi-replica deploy risk).

**Fix shipped.** `services/payments-ledger/src/middleware/mpesa-webhook.middleware.ts`
extracted into a port:

```ts
interface IdempotencyStore {
  seenBefore(key: string): Promise<boolean>;
}
```

Two implementations:

- **InMemoryIdempotencyStore** — Map-backed; legacy default; retains
  the synchronous `seenBeforeSync` API for the existing 3 server.ts
  callsites (so swapping to Redis is a deploy-time decision, not a
  code refactor).
- **RedisIdempotencyStore** — uses `SET key val NX EX 86400` so the
  claim is atomic across replicas. Falls back to in-memory on Redis
  outage (operator-visible warn log).

Composition helper `createIdempotencyStore({ redisUrl })` returns
the right implementation based on `REDIS_URL`. ioredis dep is
already wired in `payments-ledger/package.json`.

11-case vitest covers in-memory first/second-sight, Redis SET NX
semantics, custom prefix/TTL, Redis-failure fallback, legacy sync
API, tenant-key scoping, and factory env gating. All 17 mpesa
middleware tests (including the existing 6 signature tests) pass.

### KI-DEBT-004 — Owner-portal BFF returned `any`-typed composites — CLOSED (2026-05-29 — previous wave)

**Severity:** RESOLVED.

**Fix shipped.** Added `services/api-gateway/src/types/bff-enriched.ts`
with composable leaf types (`EnrichedReminder`, `EnrichedDecision`,
`EnrichedDraft`, `EnrichedTab`, `EnrichedOpportunity`, `EnrichedRisk`,
`EnrichedPinnedItem`, `ScopeNodeWithChildren`), composite envelopes
(`OwnerBrief`, `OwnerBriefEnriched`, `OwnerDashboardSnapshot`),
envelope primitives (`ApiSuccess<T>`, `ApiSuccessWithMeta<T>`,
`PaginatedResponse<T>`, `BffMeta`), domain ports (`CoOwnersPort`,
`InvitationServicePort`, `FeatureFlagsPort`), and the
`InvitationTokenPayload` HMAC contract. Threaded the types through
every handler in `owner-portal.ts`: 0 `: any` / `<any>` / `as any`
remain in that file (down from 3 explicit + 4 `Function` shorthands)
and api-gateway typecheck stays at 0 errors. All 20 BFF tests pass.

---

## Moved to roadmap (trailer)

The following items were deferred behind wave-scale work. Each has a
matching `R*` entry in `Docs/ROADMAP.md` with effort estimate, source
research doc, and suggested wave.

| Old KI ref           | Roadmap entry | Title                                                      |
| -------------------- | ------------- | ---------------------------------------------------------- |
| KI-005               | R13           | Tenant-aware defaults plumbed end-to-end                   |
| KI-006               | R14           | GePG direct-integration HTTP client wired to live sandbox  |
| KI-007               | R15           | Inspection narrative AI persona                            |
| KI-008               | R16           | Negotiation counter-offer LLM generator                    |
| KI-009               | R17           | document-chat real Anthropic adapter with citation parser  |
| KI-010               | R18           | Station-master polygon coverage                            |
| KI-011               | R19           | Production scanner deskew + PDF assembler                  |
| KI-013               | R20           | Migration Wizard copilot composition registration          |
| KI-014               | R21           | OCR cloud-adapter wiring (Textract / Vision)               |
| KI-015               | R22           | Peripheral parser/library wiring                           |
| KI-Wave18            | R23           | Renewal uplift ML heuristic upgrade                        |
| KI-MARKETING-1       | R24           | Marketing pilot-application persistence                    |
| KI-DEBT-002          | R25           | Mobile voice STT via EAS dev build                         |
| KI-DEBT-003          | R26           | Marketplace inbound gateway endpoint                       |

## Reclassified (not bugs)

The following items were classified as `LATER(wire)` architectural
placeholders rather than ship-blocker defects, and have been removed
from the bug register entirely:

- **KI-DEBT-001** — Port packages ship in-memory adapters with
  `LATER(wire)` markers. These are deliberate test-isolation seams,
  not bugs. The proposed-fix on the original entry already said
  "None — these are not bugs." Composition roots already wire the
  real adapters when the target packages mature; the in-memory
  fallbacks remain for unit-test isolation. No further tracking
  required — per-domain squads own the swap as their target package
  matures.

### KI-017 — Owner two-way calendar sync is born-dark (backend-only, NO UI entry) — **REGISTERED 2026-06-15 — LOW (incomplete feature, not user-reachable)**

`services/api-gateway/src/composition/calendar-wiring.ts` (`createCalendarWiring`)
and `services/api-gateway/src/workers/calendar-sync.worker.ts`
(`createCalendarSyncWorker`) have **zero callers** — `index.ts` never imports the
wiring, so the sync worker never `.start()`s. The owner calendar OAuth route
(`services/api-gateway/src/routes/owner/calendar.hono.ts`, migration 0171) IS
mounted (connect / callback / status / disconnect), but no writer ever creates a
`channel='calendar'` reminder, the reminders-dispatch worker drops that channel,
and the action-executor refuses to schedule it — so the two-way sync is dark end
to end.

**Why this is REGISTERED, not a shipped bug:** a repo-wide sweep finds **no
front-end caller** of `/owner/calendar/*` in any surface (owner-web,
workforce-mobile, buyer-mobile) — there is no "Connect Google Calendar" CTA, so
no user is shown a dead-end promise. This is an **incomplete backend feature**
(skeleton present, loop not closed), not a regression in any shipped behaviour.

**Proposed fix (a feature, owner-prioritised):** compose `createCalendarWiring`
in `index.ts`, add a `channel='calendar'` writer + reminders-dispatch handler
that pushes reminders/deadlines to the linked provider via the stored OAuth
connection (with token refresh + event dedup), then surface a connect entry on
the owner cockpit. Until then the route stays mounted-but-unconsumed (harmless,
OWNER-auth + OAuth gated).

### KI-018 — admin-web console uses a "bilingual show-BOTH" pattern (EN+SW together) — **PARTIAL FIX 2026-06-15 — MEDIUM (canon violation, internal surface)**

The internal admin console was built to render English AND Swahili side-by-side
(a deliberate "bilingual" design), which violates the **single-language-per-locale
canon** (one active locale → ZERO tokens of the other language anywhere). Live
proof (authed admin console): the nav read `Cockpit Dashibodi · Tenants
Wapangaji · Audit Ukaguzi · Health Afya · Brain Akili · Control tower Mnara wa
Udhibiti`, and the SSR/client split of the show-both flag drove a React #418
hydration-text mismatch.

**FIXED (this session, commit 55e6add1):** the **Sidebar** (the nav, on every
admin page — the highest-impact, most-repeated element) now threads the
server-resolved locale (RootLayout → AdminShell → Sidebar) and renders ONE label
per active locale via `pickByLocale`. No hydration mismatch on the nav.

**STILL OPEN (registered for a focused admin-i18n pass):** the same show-both
pattern remains in other admin surfaces — `DashboardMetricStrip.tsx` (KPI cards
render `{m.label}` AND `{m.labelSw}`), hardcoded `EN · SW` page eyebrows (e.g.
`app/dashboard/page.tsx` "Cockpit · Dashibodi"), and the `PersonaGreeting` chat
chips. PLUS a likely-separate React #418 from PersonaGreeting's time-of-day
greeting (SSR time ≠ client time). **Scope:** convert every admin surface to a
server-resolved locale + `pickByLocale` single-label (the Sidebar is the
template), and make the persona greeting time-stable across hydration. INTERNAL
staff surface, fully functional — this is a canon/polish defect, not a
customer-facing or fatal one. Owner/marketing surfaces are single-locale
(verified live).

End of register. **Open KI count: 0 user-reachable customer-facing; 1 incomplete feature (KI-017); 1 internal-console canon residual (KI-018, nav fixed).**
