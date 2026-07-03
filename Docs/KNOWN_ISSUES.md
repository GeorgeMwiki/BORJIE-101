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

### KI-019 — Audit-integrity sweep cannot detect TAIL-TRUNCATION of a hash chain — **REGISTERED 2026-07-03 — LOW (defense-in-depth, non-customer-facing)**

`packages/observability/src/audit/integrity-sweep.ts` (`groupRowsIntoExports`,
line 122-128) synthesizes each tenant chain's claimed `head` from the SURVIVING
rows (`head = last.thisHash`). If an attacker deletes the last N rows of a
tenant's `audit_trail_entries` chain, the recomputed head matches the (now
shorter) synthesized head, so `verifyAuditChainExport` reports the truncated
chain as VALID — internal consistency holds, but rows are gone. Payload mutation,
prev-hash rewrite, and mid-chain gaps ARE detected; only tail-truncation slips.

**Why this is REGISTERED, not a shipped bug:** the sweep is an internal
observability cron (no customer surface), and the attack requires DB-level row
deletion, which the append-only trigger + FORCE-RLS + service-role isolation
already resist. This is a defense-in-depth gap, not a reachable customer defect.

**Why not fixed in-line (avoids born-dark):** a correct fix needs a persistent,
independent per-tenant monotonic high-water anchor (`{maxSequenceId, headHash}`
in a separate durable table) that the worker reads and the sweep reconciles
against (`swept.maxSequenceId < anchor.maxSequenceId` OR `head !== anchor.head` ⇒
broken). A pure-function-only change (accept an `expectedHeads` param) with no
caller supplying the anchor would be a born-dark detector — the exact anti-pattern
the discipline forbids. Ship anchor table + migration + worker wiring together or
not at all. Owner-prioritised.

### KI-020 — "scoop" is an adopted Swahili loanword in the workforce-mobile bundle (glossary ratification) — **REGISTERED 2026-07-03 — LOW (glossary decision, no visible mix)**

The `sw.json` bundle uses **"scoop"** consistently as a Swahili-adopted mining
term (`wm06ScoopOk = "Scoop imerekodiwa kwenye seva"`, `intent = "Gusa kwa kila
scoop"`, `wm06Empty = "Bado hujahesabu scoop"`, and the W-M-06 count label
`wm06Scoops = "Scoop"`). It is ratcheted in
`scripts/__allowlists__/mobile-bundle-shared-allowlist.mjs` so the `sw==en` gate
does not flag it. This is internally consistent (canon rule 6, one term per
concept) but is an English-origin loanword.

**Decision needed (owner/glossary):** either (a) RATIFY "scoop" as the canonical
Swahili mining loanword (keep as-is — many Swahili technical terms are adopted,
e.g. "kompyuta", "simu"), or (b) replace it everywhere with a native term
(e.g. "kijiko"/"sepetu") in ONE coordinated pass across all W-M-06 keys to avoid
glossary drift. No user-visible mixing today; this is a terminology ratification,
not a bug.

### KI-021 — marketing sw.json carries a deep domain/technical English register in both locales (glossary pass) — **REGISTERED 2026-07-03 — LOW (glossary decision, consistent both-locale usage)**

After round-6 fixed the clear injected English fragments in `apps/marketing/src/i18n/sw.json`
(roadmap pills, /buyers copy) and added the `locale-purity.test.ts` gate, ~50
Swahili values still embed English domain/technical terms used CONSISTENTLY in
BOTH en and sw copy: drill-hole, audit chain, off-take, biometric, assay,
commission, tenant, append-only, payroll, hedge, pipeline, LBMA spot, OCR. These
are non-byte-equal (partial fragments), so the new purity gate does not flag them.

**Decision needed (owner/glossary):** ratify these as adopted domain loanwords
(many have no crisp Swahili equivalent) OR run ONE deliberate Swahili-ization
pass with canonical translations. Distinct from the named injected phrases (those
were fixed). A stricter fragment-level lint would be the enforcement follow-up.

### KI-022 — apps/marketing/src/i18n/sw.approved.json is a stale dead snapshot — **REGISTERED 2026-07-03 — LOW (dead file, hygiene)**

`apps/marketing/src/i18n/sw.approved.json` differs from the live `sw.json` and is
referenced NOWHERE in source (the app imports `sw.json` via `lib/i18n.ts`). It is
a stale translation snapshot. Delete it, or re-sync + wire it into an approval
workflow if it was meant to be a review gate. No runtime impact (unimported).

### KI-023 — 6 orphaned legacy worker screens carry hardcoded Swahili (no user entry) — **REGISTERED 2026-07-03 — LOW (unreachable, dead-legacy)**

`app/worker/W-M-01.tsx` (phone signin "Simu yako"), `W-M-03.tsx` + `W-M-13.tsx`
(fingerprint confirm "Thibitisha kwa kidole"), `W-M-10.tsx` (select product "Chagua
bidhaa"), `W-M-15.tsx` ("Hakuna PPE"), `W-M-18.tsx` ("Hati za rasmi") still hold
bare-string Swahili JSX attributes. They are superseded by the named `onboarding/*`
flow (welcome/phone/identity/biometric/…) and are referenced ONLY in
`src/roles/access.ts` + registered as `Stack.Screen`s — with NO CTA / Link /
router.push anywhere, so no user reaches them via normal use (deep-link only).

They are the sole entries on the `HARDCODED-SW-JSX-ATTR` shrink-only allowlist in
`src/__tests__/whole-app-zero-mix.gate.test.ts` (the round-7 detector) — a NEW
bare-Swahili-attr in any other file turns the gate RED. **Resolution (owner):**
DELETE these dead screens (+ their access.ts / _layout.tsx registrations) after
confirming no deep-link depends on them, OR route them through i18n if they are
to be revived. Not customer-reachable today.

### KI-024 — O-M-21 sign-off screen is a hardcoded mock (no live UI entry) — **REGISTERED 2026-07-03 — LOW (unreachable mock)**

`app/owner/O-M-21.tsx:76-80` renders a hardcoded PlaceholderList row ("Driver
letter · LV-2231" / "Tani 7 · Geita → Mwanza") and `:42` signs against a hardcoded
`documentId: 'LV-2231'` — a mock-where-real-promised + unconditional English
literals. Verified round-7 as Tier-2: the route has NO live UI entry (no tab/CTA
links to O-M-21). **Resolution:** when a real recent-sign-off source lands, replace
the literal row with a useQuery against the gateway sign-off endpoint, drive
documentId from the fetched row, and route the two literals through i18n. Until a
user path exists, latent.

### KI-025 — owner-web BidsInbox renders the incoming-bid price with hardcoded LAUNCH_CURRENCY — **REGISTERED 2026-07-03 — LOW (latent, correct at launch)**

`apps/owner-web/src/components/marketplace/BidsInbox.tsx:149` renders
`formatMoney(bid.bidPriceTzs, LAUNCH_CURRENCY, locale)` — a hardcoded display
currency. Correct at launch (TZS is the only domestic currency; `bidPriceTzs` is
TZS-denominated by column name), so NO user-visible defect today. Latent for
KE/UG/NG expansion. **Fix (needs a data-model change):** thread a `currency` /
`currencyCode` field onto the `IncomingBid` shape (from the listing/bid row) and
pass it to `formatMoney` instead of `LAUNCH_CURRENCY`, with a test asserting a
non-TZS bid renders its own currency. Distinct from the round-8 T21 fix (the four
owner-web money panels' hardcoded `en-US` BCP-47 literals — those were FIXED via
`bcp47For(locale)`).

End of register. **Open KI count: 0 user-reachable customer-facing; 1 incomplete feature (KI-017); 8 non-customer residuals (KI-018 admin-i18n nav-fixed, KI-019 audit-sweep tail-truncation, KI-020 scoop loanword, KI-021 marketing domain glossary, KI-022 sw.approved dead file, KI-023 orphaned legacy worker screens, KI-024 O-M-21 mock, KI-025 BidsInbox launch-currency latent).**

---

## TIER-2 CLEANUP REGISTER — review-door gauntlet (branch `fix/review-door-tier1`)

> **Compiled, not fixed — owner-gated.** Per the fix-ordering canon (engineering
> governing-law corollary 4: "Tier-1 runs the gauntlet to dry; Tier-2 is
> compiled-not-fixed, then ask-gated"), these are the **non-user-facing** findings
> the gauntlet surfaced while driving the customer-facing tier to dry. They are
> deliberately NOT fixed during the gauntlet (fixing them advances nothing toward
> Tier-1 dry). Each is `file:line` + fix-ready so the cleanup tier is trivially
> actionable once the owner unlocks it. **Do not start any T2 item without owner
> go.** This register is appended each gauntlet round.

### Round 0 harvest (2026-06-25)

- **T2-01 · Endpoint tests for the new internal tenant-detail invoice/billing routes**
  (test-debt; review #42). `services/api-gateway/src/routes/mining/internal/tenants.hono.ts`
  has zero tests on the new `GET /:id`, invoices, and billing endpoints. Add: 403 for
  non-admin, count assertions, one-row-per-fee mapping, the `status:'Posted'` contract,
  and the DEBIT/PLATFORM_REVENUE leg filter (no double-count). Held to the prod test bar
  (mutation-prove the barrier).
- **T2-02 · CI copy-lint: anti-em-dash on i18n string VALUES** (review #52 follow-up).
  The em-dashes were stripped from the 16 values this round; add a gating lint that
  flags `—` inside i18n string VALUES (not keys/comments) so the class cannot recur.
- **T2-03 · CI glossary gate: `sw:` honorific** (review #27 follow-up). The `Mr.`→`Bw.`
  sw sweep is done; add a CI grep asserting zero `sw:.*Mr\. Mwikila` (and the general
  glossary-drift set) so a future regression fails the build.
- **T2-04 · DataTable required-`emptyState` build-gate** (review #9 follow-up). The
  `'No results.'` fallback is now localized via an optional prop; the stronger
  fix is to make the empty-state prop REQUIRED so an omitting caller fails the
  build. `packages/design-system/src/components/data/DataTable.tsx`.
- **T2-05 · RouteSkeleton multi-variant rebuild** (review #49 follow-up). The
  doc-claim was softened to be honest; the real fix is 2-3 skeleton variants
  (cards / form / table) so per-route `loading.tsx` body geometry matches and the
  zero-CLS claim becomes true. `apps/owner-web/src/components/shared/RouteSkeleton.tsx`.
- **T2-06 · Re-export `decimalsForCurrency` from `@borjie/domain-models` root**
  (Stream 1 residual). The money-core fix used the public `CURRENCY_DECIMALS`
  table (same canonical ISO-4217 data) because `decimalsForCurrency` is not
  re-exported from the package root. Add the one-line re-export in
  `packages/domain-models/src/index.ts` so callers can use the named symbol.
- **T2-07 · api-gateway `typecheck` script heap bump** (Stream 1 residual / build env).
  `pnpm --filter @borjie/api-gateway run typecheck` OOMs under the default Node heap on
  the 8 GB ceiling (passes clean with `--max-old-space-size=6144`). Bake the heap raise
  into the package `typecheck` script / CI so the gate completes without a manual flag.
- **T2-08 · Dead code: `ListingActions.tsx` + `RefreshModelMetrics.tsx`**
  (Stream 3 residual). Both under `apps/admin-web/src/components/internal/{marketplace,models}/`
  have ZERO call sites (localized this round for completeness but unrendered). Either
  wire them to their surface or delete them.

### Round 1 harvest (2026-06-25 — residual-closing pass)

- **T2-09 · Type the shift-planner `structured` payload** (Stream SC residual).
  `apps/owner-web/src/lib/queries/shift-planner.ts` `ShiftPlanResult` does not type the
  new `data.structured` field, so `ShiftPlannerPanel` reads it via an `as unknown as`
  cast. Add the typed structured shape to `ShiftPlanResult` and drop the cast.
- **T2-10 · Drop the legacy English shift-planner wire fields**
  (Stream SC residual). The gateway still ships the pre-rendered English
  `plan.unassignedTasks[].reason`, `plan.rotationAlerts[].label`,
  `compliance.results[].ruleLabel/.detail`, and `compliance.blockingFailures[]` strings
  (additive, no longer rendered by the cockpit which now uses the structured keys).
  Remove them from `services/api-gateway/.../shift-planner.hono.ts` once no consumer reads them.

- **T2-11 · `Docs/` tree LitFin sibling-reference scrub** (D24 project-independence, WARNING — internal only).
  The owner instruction's verify scope was `apps/{owner,admin}-web/src` (now ZERO `litfin` — done, comment-only).
  OUT of that scope, the `Docs/` tree still advertises the sibling to maintainers: the
  `Docs/DESIGN/LITFIN_*.md` family (`LITFIN_DNA.md`, `LITFIN_STEPPER_LEARNING_SPEC.md`,
  `LITFIN_BLACKBOARD_SPEC.md`, `LITFIN_MEASURED_SPEC.md`, `LITFIN_WEB_PORTAL_SPEC.md`,
  `LITFIN_MOBILE_DNA_SPEC.md`, `LITFIN_MARKETING_SECONDARY_SPEC.md`) and
  `Docs/research/litfin-harvest.md` + `Docs/research/RENDER_DECISION_AND_THOUGHT_TREND.md`.
  Not user-facing, does not shape AI output → WARNING not blocker. Fix: rename the design
  docs to Borjie-neutral names (or fold them into a single neutral `Docs/DESIGN/` spec) and
  scrub the `litfin` token from their content + the research docs; the src comments already
  use neutral descriptions, so no src re-link is required. (Dev-only docs; no behavior.)

### Round 2 harvest (2026-06-25 — gauntlet round 1 full re-hunt; 6 Tier-2 of 39 confirmed)

- **T2-12 · AiCostsClient stale docstring** (D17 docs). `apps/admin-web/src/app/ai-costs/AiCostsClient.tsx:18-20`
  claims "no server-seeded locale prop" but the page now does seed one. Update the comment to match.
- **T2-13 · admin-web locale-default formatting** (D6 formatting, internal console). `AiCostsClient.tsx:235`
  formats numbers/dates with the runtime default locale; `apps/admin-web/src/lib/api.ts:114-133`
  `formatCurrency`/`formatDate` default `locale='en'` and are called without the active locale. Thread the
  resolved locale into the formatters (low — internal admin surface).
- **T2-14 · backend worker narratives hardcode 'TZS'** (currency-canon, non-user-facing worker text).
  `services/.../outcome-resolvers.ts:223-225` and `decision-retrospective-worker.ts:167-168` hardcode `'TZS'`
  + locale-less `toLocaleString()` in narrative strings. Route through `formatCurrency(amount, currencyCode)`.
  (Worker narrative, not a direct user render → Tier-2, but it IS a currency-canon violation; fix in the cleanup pass.)
- NOTE: `packages/.../locale-purity.test.ts` is RED on this branch, but that is a SYMPTOM of the Tier-1
  CounterpartiesShell hardcoded-Swahili finding — it turns GREEN when that Tier-1 fix lands (round 2), so it is
  NOT a separate Tier-2 item.
- **T2-15 · Pre-existing admin persona-drift test fails (request-context)** (test-debt, not introduced this session).
  `apps/admin-web/src/app/persona-drift/__tests__/page.test.tsx` — `PersonaDriftPage` calls
  `readLocaleFromServerCookies()` → `cookies()` outside a Next request context (Next E251), so the test errors.
  Fix: wrap the server-component render in a request-context test harness (or mock `cookies()`). Pre-dates the
  gauntlet; surfaced by the full admin vitest run.
- **T2-16 · Multi-currency MRR tile can overflow at the smallest width** (D25 responsive, admin subscriptions).
  `SubscriptionsClient.tsx` Total-MRR tile now renders per-currency totals joined by ' · ' in a
  `font-display text-2xl` StatTile; many distinct currencies could overflow at the min width. Not clipped/ellipsis
  today, but a multi-currency-tile design pass is worth it. Low.

### Round 3 harvest (2026-06-25 — close remaining Tier-1; 2 register items)

- **T2-17 · Inventory on-hand-value endpoint carries no ISO currency (multi-region readiness)** (region×language canon).
  `services/api-gateway/src/routes/mining/inventory.hono.ts` (`GET .../inventory/analytics/on-hand-value`)
  returns `byCategoryValueCents`/`totalValueCents` with NO ISO-4217 currency; `OnHandValueSchema` in
  `apps/owner-web/src/lib/queries/inventory.ts` has no `currency` field. The FE now self-labels with the tenant
  `LAUNCH_CURRENCY` — CORRECT for TZ launch tenants, WRONG for KE/UG/NG expansion tenants (currency must follow
  the detected region per the new locale=language×region canon). Add an explicit `currency` field to the payload +
  schema and render it. Not launch-blocking (TZ-only launch); required before multi-region.
- **T2-18 · sw linguist/glossary QA pass on engineer-authored translations** (language quality).
  The new `intentSw` (37 screens) + other sw copy added this gauntlet are faithful + single-language-correct (no
  mixing, full parity) but were authored by an engineer, not a native-speaker linguist. Queue a glossary/linguist
  review pass. Non-blocking polish (zero-mix + parity already hold).

### Research-hardening CI gates (2026-06-25 — deep-research delta; construction-level prevention, owner-gated)

These are the standing CI gates from the strategy-hardening research — each retires an invisible defect-class
this gauntlet surfaced, BY CONSTRUCTION. They are Tier-2 (CI/tooling), parked for the owner's go.

- **T2-19 · Error-handling integrity gates** — enable `@typescript-eslint` type-aware rules project-wide
  (`no-floating-promises`, `no-misused-promises`, `no-empty {allowEmptyCatch:false}`, `only-throw-error`);
  add `eslint-plugin-neverthrow must-use-result`; author a new `borjie/no-failure-as-success` rule (sibling to
  `no-jurisdictional-literal`/`require-csrf-headers`) flagging a Supabase/HTTP write whose result isn't
  destructured-with-`.error`/Result-consumed before a success side-effect.
- **T2-20 · Server-side i18n / wire-neutral gates** — `eslint-plugin-i18n-json identical-keys` (hard key-parity)
  + a parity-diff failing on sw==en byte-identical values; `@formatjs/eslint-plugin-formatjs` (no-invalid-icu,
  enforce-plural-rules, no-literal-string-in-jsx); typed i18n keys so a missing `t()` key is a compile error;
  a `*_en/*_sw` prose-column + human-sentence-on-the-wire scanner (allowlist-ratchet).
- **T2-21 · AuthZ gates** — `route-detect` per-route authz allowlist as a deny-by-default ratchet; a doc-vs-code
  guard-reconciliation check; Next.js `>=14.2.25/15.2.3` pin + `x-middleware-subrequest` strip assertion;
  a cross-identity IDOR/BOLA replay CI suite (A-on-B across GET/PUT/PATCH/DELETE → assert 401/403/404);
  pgTAP RLS proof gate (`relforcerowsecurity=true` for every tenant table + cross-tenant invisibility).
- **T2-22 · Resilience/numeric gates** — timeout-census + SSE-heartbeat-presence + finite-guard +
  currency/threshold magic-literal scanners as four allowlist-ratchet checks (same shape as the existing
  `audit-hardcoded-locale-coverage.mjs`); a deterministic fault-injection CI job (force-deny a tenant GUC →
  assert the worker processes ZERO rows LOUDLY; drop the LLM key → assert honest fallback).
- **T2-23 · Test-strength gates** — StrykerJS mutation gate (≥80% score) on `payments-ledger`/RLS/auth/
  `kernel-egress`/`policy-gate`; fast-check property suite (round-trip parse∘serialize, ledger debits==credits,
  a metamorphic zero-mix property: locale toggle ⇒ full string swap, zero residual);
  `@typescript-eslint/switch-exhaustiveness-check` + `never`-assert defaults on every discriminated union;
  a detector-register-growth check (the escaped-bug ratchet: a fix for an escaped defect must add a detector).

### Round 4 harvest (2026-06-25 — hunt-3 D24 property-residue cluster; compiled-not-fixed, owner-gated)

> All Tier-2 because non-user-facing: born-dark taxonomies, model-read-but-not-rendered tool descriptions,
> internal SUPER_ADMIN tooling, latent (not-yet-triggered) fallbacks, dormant emitters, or dead trees with
> zero source importers. Each is a **D24 domain-purity** residue (property: tenant/rent/lease/unit). None
> reach a customer surface today; fix in the cleanup pass or when the dependent feature is built.

- **T2-K1 · Progressive-intelligence property taxonomy serialized but FE-dropped** (D24 domain purity).
  `packages/database/src/services/migration-writer.service.ts:19,83` (`PropertyDraft` + `tenantProfile`/
  `leaseTerms` fields) is computed by `progressiveAutoGen.buildPreview` and serialized into
  `services/api-gateway/src/routes/migration.router.ts:139,154` (`progressivePreview`). **Tier-2:** grep of
  `apps/**` for `progressivePreview` = ZERO renderers — the FE drops the whole bag, so no property taxonomy
  reaches a user. **Fix when unparked:** re-domain `PropertyDraft`→mining-asset / `tenantProfile`→operator /
  `leaseTerms`→licence-terms when the `/migration/upload` preview pane is actually built (do BOTH the writer
  type and the router serialization in one coordinated rename).
- **T2-K2 · openclaw shipped-domain catalog property ids** (D24 domain purity — coordinated rename).
  `packages/openclaw-operating-model/src/agent-domains/catalog.ts:24,41,89` seed domain ids `lease-renewal`/
  `rent-collection`/`tenant-onboarding` at boot. **Tier-2:** repo-wide grep finds ZERO runtime consumers of
  the catalog (only the `evals/pms-bench-1` harness references the id strings + 4 in-package pinning tests);
  nothing renders or routes on these ids in any app/service. **Fix when unparked:** coordinated rename owns
  `catalog.ts` + the 4 pinning test files (`agent-domains.test.ts`, `agent-as-a-service.test.ts`,
  `autonomy-ladders.test.ts`, `chief-agent-officer.test.ts`) — re-domain to mining concepts
  (offtake-renewal / royalty-collection / operator-onboarding) and update the pins in lockstep.
- **T2-K3a · advisor hard-category property tags + property regex** (D24 — live routing tag, never rendered).
  `packages/ai-copilot/src/providers/advisor.ts:31,35` + `personas.catalog.ts` (multiple) declare
  `lease_interpretation`/`tenant_termination` categories; `orchestrator.ts:1067` `inferHardCategory` matches a
  property regex (`/\b(lease|renewal|clause|termination|security deposit)\b/`, `/\b(evict|terminate|quit
  notice|vacate)\b/`) → returns the tag at `:1078,:1098`. **Tier-2:** the returned category is an internal
  routing/escalation tag (drives policy-gate tiering), never rendered as user copy. **Fix when unparked:**
  rename the category enum + persona declarations + regex tokens to mining-estate hard categories
  (licence_interpretation / operator_termination) across advisor.ts + personas.catalog.ts + persona.ts +
  orchestrator.ts together (enum is cross-file — one coordinated rename).
- **T2-K3b · proactive-insights `arrears_followup` taxonomy is fully dark** (D24 — born-dark, wrong package).
  `packages/ai-copilot/src/proactive-insights/types.ts:12`, `insight-rules.ts:147,154`,
  `predictive-needs.ts:20,23,39` define + emit the `arrears_followup` category. **Tier-2:** grep of
  `services/**`+`apps/**` for `proactive-insights` = ZERO non-test importers — the LIVE proactive loop runs
  on `@borjie/proactive-intel` (the `proactive-intel.worker.ts` + `tick-inputs-provider.ts`), NOT this
  ai-copilot module, so the taxonomy never executes. **Fix when unparked:** either delete the dead
  `proactive-insights` module or re-domain the category (royalty_arrears_followup) if it is to be revived;
  decide vs `@borjie/proactive-intel` (do not maintain two parallel insight engines).
- **T2-K4a · AI-tool description property residue: hr.ts 'property coverage'** (D24 — model-read, not rendered).
  `packages/ai-copilot/src/skills/domain/hr.ts:135` tool description ranks team members by "…language,
  property coverage, current load…". **Tier-2:** this string is fed to the model as a tool description (shapes
  ranking), never surfaced verbatim to a user. **Fix when unparked:** reword to mining-estate terms (site /
  asset coverage) — single-line edit, no contract change.
- **T2-K4b · AI-tool buyer-credit property fields** (D24 — model-read scoring inputs, not rendered).
  `packages/ai-copilot/src/credit-rating/scoring-model.ts:164,185,190` use `avgTenancyMonths` +
  `subleaseViolationCount` (declared `credit-rating-types.ts:102` etc.) in the score + reason string.
  **Tier-2:** these are internal scoring inputs / model-facing reason text on the buyer-credit skill; not a
  direct user render in any shipped surface today. **Fix when unparked:** re-domain the field names +
  reason copy to mining counterparty terms (avg engagement months / contract-breach count) — touches the
  type, the model, and the test fixtures together.
- **T2-K4c · AI-tool reissue-letter `tenant_dispute` + 'Tenant-facing'** (D24 — enum + model-read description).
  `packages/ai-copilot/src/skills/admin/reissue-letter.ts:3,24,45,54` — `tenant_dispute` reason enum value +
  "Tenant-facing" in the tool description/comment. **Tier-2:** enum value drives a PROPOSED-action skill (the
  description is model-read); not rendered as user copy. **Fix when unparked:** rename the enum value
  (counterparty_dispute) + reword the description; coordinate with any caller that passes the literal.
- **T2-K5 · drafts.hono `titleEn ?? titleSw` cross-language fallback (LATENT)** (zero-mix / wire-is-locale-neutral).
  `services/api-gateway/src/routes/owner/drafts.hono.ts:292,483,533` render `draft.titleEn ?? draft.titleSw`
  — if `titleEn` is null, an EN surface would receive the SW title (a cross-language fallback the canon
  forbids). **Tier-2 (latent, not live):** the writer at `:121-122` seeds `titleEn` and `titleSw` to the
  SAME string today, so the fallback branch never produces a mixed render in practice. **Fix when unparked:**
  drop the cross-language `??` — pick by active locale and fall back to a neutral placeholder
  (`'Current draft'` per active locale), never to the other language's title. (Same latent pattern exists in
  `field/workforce.hono.ts:501-502,589-590` and `mining/tasks.hono.ts:336` — sweep all three together.)
- **T2-K6 · voice-bridge dormant code-switch emitter + voice-persona-dna property residue** (zero-mix / D24).
  `packages/central-intelligence/src/kernel/voice-bridge.ts:176-178` `describeVoice` emits a code-switch
  instruction ("may insert {locales} for {contexts}") **only when** `profile.codeSwitching` is set;
  `packages/ai-copilot/src/voice-persona-dna/profiles.ts:42,74,106` leave `codeSwitching` UNSET on all 6
  profiles (commented "zero-mix canon"). **Tier-2:** the emitter is dormant by construction (no profile
  populates the field), so no code-switch prose ever reaches the model/user; the profiles.ts file also
  carries property comments (`:16,22,25,26` tenant/lease/applicant) + `'read the lease'` (`:119`).
  **Fix when unparked:** delete the dormant `codeSwitching` branch from `describeVoice` (a zero-mix
  trap-door that could re-enable mixing if a future profile sets it) + re-domain the profiles.ts property
  comments/strings to mining-estate language.
- **T2-K7 · mission-eval property capability-bucket id** (D24 — internal SUPER_ADMIN eval tooling).
  `apps/admin-web/src/app/mission-eval/MissionEvalClient.tsx:554` renders `{r.capability ?? '—'}`; the bucket
  taxonomy is documented as the "6-bucket property-management surface set (rent reconciliation, lease…)" in
  `services/api-gateway/src/composition/parity-capability-dashboard.factory.ts:7`. **Tier-2:** mission-eval is
  internal Borjie-team eval tooling (admin-web `/mission-eval`, reads `/api/v1/parity/capability/dashboard`),
  not an owner/customer surface; the capability id is an opaque routing/rollup key. **Fix when unparked:**
  re-domain the capability-prefix → bucket map in the factory to mining capability buckets and update the
  factory docstring; the FE renders the id verbatim so no FE change beyond the new id strings.
- **T2-K8 · repo-root `src/core` + `src/features` dead tree (435 files)** (dead code — candidate for deletion).
  `src/core/{swahili-intelligence,emoji,language-intelligence,…}` + `src/features/` total 435 files with ZERO
  source importers (grep of `apps/**`+`services/**`+`packages/**` for these paths = empty) and the tree is in
  NO `tsconfig` path. **Tier-2:** never compiled, never imported, never reachable — pure dead weight from a
  pre-monorepo era. **Fix when unparked:** delete the `src/core` + `src/features` trees wholesale after a
  final confirmation grep (one `git rm -r`); they are not the monorepo `packages/**` sources and removing them
  cannot affect any build.
