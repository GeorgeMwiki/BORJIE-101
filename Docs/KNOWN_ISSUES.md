# Known Issues

Running log of surfaced bugs that were not fixed inline because they
exceed a ~1-hour scope (cross-package refactors, schema migrations that
need coordinated rollout, infra config, etc.). Each entry includes
precise `file:line`, reproduction steps, root cause, and proposed fix.

Fixes marked inline in `git log` are NOT listed here.

---

## KI-001 — Drizzle migration ledger drift in local dev DB

**Severity:** MEDIUM (local-dev only — CI DB is clean)

**Symptoms.** A GET against `/api/v1/compliance/exports` and a POST to
`/api/v1/risk-reports/{customerId}/generate` returned raw 500 "Internal
Server Error" responses. The Postgres errors are
`relation "compliance_exports" does not exist` and
`relation "tenant_financial_statements" does not exist`, despite the
drizzle migrations table (`drizzle.__drizzle_migrations`) showing those
migrations (0018, 0020, 0021) as applied.

**Reproduction.**
```bash
psql "$DATABASE_URL" -c "SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = '0021_compliance_exports';"
# id | hash -> 34 | 0021_compliance_exports  (applied)

psql "$DATABASE_URL" -c "\dt compliance_exports"
# Did not find any relation named "compliance_exports".
```

**Root cause.** The migrations table records the hash as applied but
the CREATE TABLE statements were somehow never executed (a prior DB
surgery, a partial rollback, or a migration ordering issue). Drizzle
does not detect this — it skips migrations whose hash is already in
the ledger, so re-running `migrate-prod.ts` does not recover the
missing tables.

**Inline workaround applied.** The missing tables were re-created by
hand-running the `.sql` migration files (they use `IF NOT EXISTS`
guards so they are safe to re-run):
```
psql "$DATABASE_URL" -f packages/database/src/migrations/0018e_tenant_finance.sql
psql "$DATABASE_URL" -f packages/database/src/migrations/0020b_tenant_risk_reports.sql
psql "$DATABASE_URL" -f packages/database/src/migrations/0021_compliance_exports.sql
```

The composition routers (`routes/compliance.router.ts:46`,
`routes/risk-reports.router.ts:40`) were hardened to return
structured 503 / 500 JSON bodies instead of the raw text 500 when a
DB error slips through.

**Proposed fix.**
1. Add a `scripts/verify-migrations.ts` that, at gateway boot, compares
   `drizzle.__drizzle_migrations.hash` against a list of tables each
   migration is expected to create. Emit a WARN line for each drift
   and refuse to boot in `NODE_ENV=production`.
2. Audit the CI DB + staging DB for the same drift before the fix
   lands — the CI DB is clean today but any restore-from-backup flow
   that predates this audit may ship the drift.

**Owners.** Platform / DBA.

---

## KI-002 — OpenAPI catalog drift between `export-openapi.mjs` and live routers

**Severity:** LOW (docs-only; live `/api/v1/openapi.json` is the
source of truth for clients).

**Symptoms.** The committed
`Docs/api/openapi.generated.json` listed endpoints that do not exist
in the routers and was missing endpoints that do. Examples found in
the 2026-04-19 sweep:

| Catalog (old)                                             | Router reality                                  |
|-----------------------------------------------------------|-------------------------------------------------|
| `POST /api/v1/applications`                               | Only `POST /api/v1/applications/route`          |
| `POST /api/v1/scans/pages`                                | Actual path is `POST /scans/bundles/{id}/pages` |
| `POST /api/v1/notification-webhooks/{provider}`           | Only africastalking, twilio, meta               |
| `GET /api/v1/risk-reports/{customerId}`                   | Actual path ends `/latest`                      |
| `GET /api/v1/financial-profile/{customerId}/statements`   | Only `POST /financial-profile/statements`       |
| `GET /api/v1/occupancy-timeline/{unitId}`                 | Actual `GET /{id}/occupancy-timeline`           |
| `GET /api/v1/letters`                                     | No list endpoint; only `GET /:id`               |

**Root cause.** `services/api-gateway/scripts/export-openapi.mjs`
maintains a **hand-written** `catalog` array that drifts whenever a
router is refactored without syncing the script.

**Inline workaround applied.** Patched catalog entries that had drift.
Regenerated `Docs/api/openapi.generated.json` (86 paths, previously 73).

**Proposed fix.** Replace the hand-written catalog with an invocation
of the already-working runtime harvester in
`services/api-gateway/src/openapi/route-harvester.ts` — it walks the
real Hono `.routes` table and emits the full spec (306 paths at the
time of this writing). The CLI entry point already exists at
`src/openapi/export-cli.ts`; wire `openapi:export` to call it instead
of the .mjs script.

---

## KI-003 — 40+ routers call service methods without null guards

**Severity:** LOW in production (composition root always wires
services when `DATABASE_URL` is set); MEDIUM for sandbox/demo
deployments where some services are intentionally omitted.

**Symptoms.** Any `POST` handler in e.g.
`services/api-gateway/src/routes/renewals.router.ts`,
`routes/financial-profile.router.ts`, etc. does:
```ts
const service = c.get('renewalService');
const result = await service.xxx(...);  // throws if service is undefined
```
If the service is not wired (composition-root skip), this throws
`TypeError: Cannot read properties of undefined` → raw 500.

**Sample repro.** Unset `DATABASE_URL`, boot gateway, then
`POST /api/v1/renewals/{leaseId}/propose` → 500 with no JSON body.

**Inline workaround applied.** The highest-traffic offenders
(`risk-reports.router.ts`, `compliance.router.ts`) now null-check the
service and return a structured 503.

**Proposed fix.** A small Hono middleware factory
`requireService('renewalService')` that short-circuits to a structured
503 when the service is absent. Apply it to each router. Roughly a
4-hour patch across 40+ files but behaviourally risk-free.

---

## KI-004 — MCP `relation "maintenance_cases" does not exist` when tool called

**Severity:** LOW (local-dev only; table is expected in production).

**Symptoms.** `POST /api/v1/mcp` with
`{"method":"tools/call","params":{"name":"list_maintenance_cases"}}`
returns a JSON-RPC error
`{"code":-32000,"message":"relation \"maintenance_cases\" does not exist"}`.

**Root cause.** Same ledger drift as KI-001 — migration for
`maintenance_cases` is recorded but the table is absent in the local
DB.

**Proposed fix.** Part of KI-001 — add the migrate-verify step. No
router change needed; MCP already surfaces the Postgres error cleanly
via its error envelope.

---

## KI-005 — Tenant-aware defaults (timezone, locale, currency, city) not plumbed

**Severity:** LOW (defaults fall back to neutral values — UTC, en, USD).

**Sites.**
- `services/api-gateway/src/routes/scheduling.ts:205` — availability
  timezone hardcoded to `UTC`.
- `services/notifications/src/whatsapp/reminder-engine.ts:625` —
  reminder date format uses bare `sw` / `en` language tag.
- `services/reports/src/services/morning-briefing.service.ts:218` —
  weather lookup has no location; `230` — day-of-week is `en` only.
- `packages/marketing-brain/src/sandbox/sandbox-scenarios.ts:324` —
  sandbox hardcodes a locale.
- `packages/chat-ui/src/generative-ui/block-generator.ts:83` —
  defaultCurrency fallback.
- `packages/ai-copilot/src/skills/estate/property-valuation.ts:30` —
  currency is caller-supplied but should also accept a tenant default.
- `packages/domain-models/src/intelligence/tenant-preference-profile.ts:203`
  — timezone populated from a fallback.

**Root cause.** The `tenants` table does not yet expose
`defaultTimezone`, `defaultLocale`, `primaryCity`, or
`defaultCurrency` columns surfaced to the API layer. Country-code-based
currency resolution already works via `getDefaultCurrency(countryCode)`.

**Proposed fix.**
1. Schema migration: add `defaultTimezone` (IANA),
   `defaultLocale` (BCP-47), `primaryCityName`, `defaultCurrency`
   columns to `tenants` (nullable; fall back to country-code defaults).
2. Surface the resolved values through the auth middleware in a
   `c.get('tenantSettings')` context.
3. Replace each TODO(KI-005) site with a read from that context.

**Owners.** Platform / Tenant-onboarding.

---

## KI-006 — GePG direct-integration HTTP client still sandbox-synthetic

**Severity:** LOW in Tanzania launch (PSP-shortcut mode is the
primary path per RESEARCH_ANSWERS.md Q2; direct GePG is a fallback).

**Sites.** `services/payments/src/providers/gepg/gepg-client.ts:63` and
`:145` — sandbox branch synthesizes deterministic 12-digit control
numbers so the downstream pipeline (matcher, ledger, notifications)
can be exercised without live credentials.

**Root cause.** Live GePG sandbox credentials (SP, SpSysId, PKCS#12
cert) have not been provisioned. Production path through the PSP is
fully wired; GePG-direct is the backup.

**Proposed fix.** When credentials land, replace the sandbox branch
with the real SOAP/REST envelope build (spec §3) — the function
signature already matches the production return shape so only the
body is missing.

**Owners.** Payments / TZ launch squad.

---

## KI-007 — Inspection narrative generation awaits AI-persona wiring

**Severity:** LOW (inspections compile and save correctly — the
`narrative` field just defaults to a terse summary until a persona is
plugged in).

**Sites.**
- `services/domain-services/src/inspections/conditional-survey/conditional-survey-service.ts:231`
  and `:312`.
- `services/domain-services/src/inspections/move-out/move-out-checklist-service.ts:472`
  and `.../photo-comparator.ts:39`.
- `services/domain-services/src/inspections/far/far-scheduler.ts:45`.

**Root cause.** The narrative-generation persona / prompt-chain
(`packages/ai-copilot/src/personas/inspection-narrator.ts`) has not
been authored yet. Ports accept an optional persona seam already.

**Proposed fix.** Author the persona under `ai-copilot/personas`,
register with `BrainRegistry`, inject into each inspection service
via the composition root.

**Owners.** AI-Copilot.

---

## KI-008 — Negotiation AI counter-offer generator is a stub

**Severity:** LOW (the stub clamps midway between last offer and
lowerBound — policy re-check still runs after, so no compliance risk).

**Site.** `services/domain-services/src/negotiation/negotiation-service.ts:161`
— `defaultStubAiCounterGenerator`.

**Root cause.** Anthropic client adapter not yet wired to this
service. `packages/ai-copilot/src/providers/anthropic-client.ts`
exists; the negotiation service needs a thin adapter.

**Proposed fix.** Add `packages/ai-copilot/src/personas/negotiator.ts`
exporting an `AiCounterGenerator`, wire via composition root. Keep
the post-LLM policy re-check as the safety net.

**Owners.** AI-Copilot + Leasing.

---

## KI-009 — document-chat service still uses `StubAnthropicDocChatLlm`

**Severity:** MEDIUM (RAG answers are deterministic echo strings with
one citation, not real LLM answers). Functionally visible to users
who query documents.

**Site.**
`services/document-intelligence/src/services/document-chat.service.ts:306`.

**Root cause.** The Anthropic Messages client is available at
`packages/ai-copilot/src/providers/anthropic-client.ts` but the
DocChat service has not been rewired.

**Proposed fix.** Replace `StubAnthropicDocChatLlm` with a real
adapter that emits `<citations>` tags per claim and parses them back
into `DocChatCitation[]`. Unit test with recorded fixtures. Gate on
`ANTHROPIC_API_KEY` presence at composition root; fall back to stub
when absent.

**Owners.** Document-Intelligence.

---

## KI-010 — Station-master polygon coverage deferred until GeoNode live

**Severity:** LOW. Radius-based and district-based coverage work; only
`polygon` kind is skipped.

**Sites.**
- `services/domain-services/src/routing/station-master-router.ts:83`.
- `services/domain-services/src/routing/types.ts:14`.
- `packages/database/src/schemas/station-master-coverage.schema.ts:29`.
- `apps/admin-portal/src/features/station-master-coverage/StationMasterCoverageEditor.tsx:8`.

**Root cause.** GeoNode (OSM-derived admin-polygon service) is not
yet deployed. Depends on `@googlemaps/js-api-loader` + `@turf/boolean-point-in-polygon`.

**Proposed fix.** When GeoNode ships, swap the `polygon` case from
`skip` to `turf.booleanPointInPolygon` lookup; lift the guard in
`polygon-kind` tests.

**Owners.** Platform / Geo.

---

## KI-011 — Production scanner missing deskew + PDF assembler

**Severity:** LOW (scans are delivered as per-page images; single-PDF
output is a deferred nice-to-have).

**Sites.** `services/document-intelligence/src/scan/scan-service.ts:130`
(deskew), `:140` (PDF assembler), `:249` (per-page buffer fetch).

**Root cause.** WASM OpenCV and `pdf-lib` not yet in the dep graph.

**Proposed fix.** Add `pdf-lib` + `@techstark/opencv-js` behind a
feature flag; wire the deskew step into the scan pipeline.

**Owners.** Document-Intelligence.

---

## KI-012 — M-Pesa webhook idempotency cache is process-local

**Severity:** MEDIUM for multi-replica deployments (two pods could
accept the same `CheckoutRequestID` concurrently before either
persists the ledger entry, enabling a narrow double-credit window).

**Site.**
`services/payments-ledger/src/middleware/mpesa-webhook.middleware.ts:11`.

**Root cause.** The cache is an in-process `LRUCache`. Redis is
available (`REDIS_URL`) but not wired here.

**Proposed fix.** Add a `RedisIdempotencyStore` adapter that uses
`SET key val NX EX 300` to claim the slot atomically. Swap via
composition root when `REDIS_URL` is set.

**Owners.** Payments.

---

## KI-013 — Migration Wizard copilot `/ask` endpoint is a thin ack

**Severity:** LOW (the wizard UX still works in read-only mode; chat
replies are placeholder acks until the copilot is wired).

**Site.** `services/api-gateway/src/routes/migration.router.ts:167`.

**Root cause.** `MigrationWizardCopilot` exists in
`packages/ai-copilot/src/copilots/migration-wizard/` but is not yet
registered in the shared `BrainRegistry`.

**Proposed fix.** Register the copilot at composition root, replace
the ack with `copilot.run({ tenantId, actorId, runId, message })`.

**Owners.** AI-Copilot.

---

## KI-014 — OCR provider adapters still stubbed (Textract / Vision)

**Severity:** LOW (tesseract fallback works for dev; production
tenants needing Textract/Vision quality are not yet onboarded).

**Site.** `services/document-intelligence/src/providers/types.ts:7`.

**Root cause.** `@aws-sdk/client-textract` and
`@google-cloud/vision` are declared optional deps to keep the package
buildable without cloud credentials.

**Proposed fix.** Add a `pnpm add -F @borjie/document-intelligence`
step for the two SDKs in the deployment image; wire the adapters.

**Owners.** Document-Intelligence.

---

## KI-015 — Peripheral stubs: xlsx parser, docxtemplater, ScannerCamera, feed adapter

**Severity:** LOW. Each has a clear graceful-degradation path.

**Sites.**
- `packages/ai-copilot/src/services/migration/parsers/xlsx-parser.ts:24`
  — `exceljs` wiring (CSV is the live path).
- `packages/ai-copilot/src/services/migration/parsers/csv-parser.ts:22`
  — papaparse upgrade (hand-rolled parser works).
- `services/domain-services/src/documents/renderers/renderer-interface.ts:9`
  — `docxtemplater` install pending.
- `packages/design-system/src/ScannerCamera.tsx:50,58,65,134` —
  camera + edge detection is a React-surface-only stub.
- `packages/market-intelligence/src/feed-adapters/external-feed-placeholder.ts:2`
  — external market-feed adapter.
- `services/reports/src/generators/interactive-html-generator.ts:61` —
  video player polish (videojs / Plyr).

**Root cause.** Each depends on a library install or external
credential that is not on the current milestone.

**Proposed fix.** File individual tickets per site when a tenant
contract requires the feature.

---

## KI-Wave18 — Renewal uplift heuristic is a flat 5 percent

**Severity:** LOW

**Symptoms.** The scheduled `renewal_proposal_generator` dispatches a
real proposal through `RenewalService.propose()` (Wave 18 fix) but
computes the proposed rent as a flat `currentRent * 1.05`. The model
service that would give a market-aware suggestion is not yet wired.

**File.**
`services/api-gateway/src/composition/background-wiring.ts` —
`buildTaskData(registry)` → `renewalProposal.propose` closure.

**Proposed fix.** Swap the heuristic for a call into the renewal
optimizer once the ML service ships. The port signature
(`RenewalProposalPort.propose`) already accepts the current rent +
days-to-expiry so no breaking API change is needed.

**Owners.** Various squads — file per use case.

---

## KI-MARKETING-1 — Pilot application submissions are not persisted

**Severity:** LOW (pre-launch; marketing site is dev/staging only).

**Symptoms.** The marketing surface POSTs to
`/api/v1/marketing/pilot-application` and receives `201 { success:
true }`, but the validated payload is only emitted to the structured
logger — it is not persisted and no inbound notification fires.

**File.**
`services/api-gateway/src/routes/marketing.hono.ts` —
`/pilot-application` handler.

**Proposed fix.**
1. Add a `marketing.pilot_applications` table via a new Drizzle
   migration (`packages/database/src/migrations/`).
2. Insert the validated payload through a thin `PilotApplicationRepo`
   bound at the composition root.
3. Trigger an email to `pilot@borjie.co.tz` via the notifications
   service so a human picks the inbound up.

Out of scope for the cleanup wave because it spans a migration + new
repo + composition wiring + notifications fan-out.

**Owners.** Marketing / Platform.

---

## KI-DEBT-001 — Port packages ship in-memory adapters with `LATER(wire)` markers

**Severity:** LOW (deliberate architectural pattern; production
composition roots already swap these for real adapters).

**Symptoms.** The following packages export `LATER(wire):` markers
where in-memory port implementations document the production
adapter they are meant to be swapped for:

| File                                                                  | Production target                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/market-intelligence/src/ports.ts`                           | LBMA/KITCO price, `@borjie/fx-treasury-advisor`, `@borjie/authz-policy`, `@borjie/proactive-intel`, `@borjie/observability` |
| `packages/market-intelligence/src/demand-forecaster.ts`               | `@borjie/forecasting.createHoltWintersForecaster` + conformal     |
| `packages/market-intelligence/src/disruption-detector.ts`             | `@borjie/proactive-intel.compose` + `@borjie/anomaly-detection`   |
| `packages/market-intelligence/src/sell-signals.ts`                    | `@borjie/causal-inference.fuelPriceImpact` / royalty attribution  |
| `packages/buyer-marketplace-advisor/src/ports.ts`                     | `@borjie/mining-commodity-intelligence`, `@borjie/compliance-pack`, `@borjie/geo-intelligence` + `@borjie/geo-parcels` |
| `packages/mining-shift-planner/src/ports.ts`                          | `@borjie/assignment-registry`, `@borjie/regulatory-tz-mining` OSHA-TZ ruleset |
| `packages/user-context-store/src/search/in-memory-index.ts`           | pgvector or hosted vector DB (issue #18)                          |

**Root cause.** These leaf packages are intentionally deterministic
+ network-free so unit tests stay fast and isolated. Composition
roots in `services/api-gateway/src/composition/` already wire the
real adapters; the in-memory fallbacks are only used in tests + CLI
scaffolds.

**Proposed fix.** None — these are not bugs. As each target package
matures, swap the in-memory wiring in the composition root and
delete the `LATER(wire):` marker. The port shapes are intentionally
identical so the swap is mechanical.

**Owners.** Per-domain squads (Market intelligence, Buyer marketplace,
Shift planner, RAG / corpus).

---

## KI-DEBT-002 — Mobile voice STT in `O-M-02.tsx` requires EAS dev build

**Severity:** LOW (gracefully degrades — placeholder copy prefills
the draft and the owner can edit before sending).

**File.** `apps/workforce-mobile/app/owner/O-M-02.tsx:75` — the voice
button's `onPress` handler emits a placeholder rather than triggering
the Swahili STT pipeline.

**Root cause.** Live Swahili speech-to-text needs the
`@borjie/voice-agent` / Spitch native module which is not yet bundled
into the Expo Go runtime; it requires an EAS dev build (tracked under
issues #14 + #22).

**Proposed fix.** When the voice phase ships and EAS dev builds are
available, replace the placeholder prefill with a call into the real
voice agent + on-device STT pipeline.

**Owners.** Voice phase squad.

---

## KI-DEBT-003 — Marketplace inbound column has no gateway endpoint

**Severity:** LOW (UI surface displays a clearly-labelled mock list
until the buy-side `/api/v1/mining/marketplace/inbound` lands).

**File.** `apps/owner-web/src/components/marketplace/MarketplaceBoard.tsx:27`.

**Root cause.** Issue #20 — the inbound (buy-side) marketplace
endpoint is not yet implemented in `services/api-gateway`.

**Proposed fix.** Stand up `routes/mining/marketplace.hono.ts ::
listInbound`, wire to the buyer-marketplace-advisor read model, and
swap the mock data path in the renderer for a `useMarketplaceInbound`
query.

**Owners.** Marketplace + Buyer squads.

---

## KI-DEBT-004 — Owner-portal BFF returned `any`-typed composites — CLOSED (2026-05-29)

**Severity:** RESOLVED.

**File.** `services/api-gateway/src/routes/bff/owner-portal.ts`.

**Root cause.** Every handler in the owner-portal BFF returned
composite enriched payloads (owner brief + reminders + recent
decisions + pinned items + scope tree + invitation receipts, etc.)
typed as `any` because no shared envelope shape existed. Additional
`Function` shorthands hid service-port contracts. The `c.json(...)`
boundary was therefore unverified at compile time and accepting any
payload shape silently broke contract drift detection.

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

**Owners.** Platform BFF squad.
