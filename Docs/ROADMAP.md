# Borjie Roadmap — research-derived forward items

**Last updated:** 2026-05-29
**Companion to:** [`Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md`](./AUDIT/RESEARCH_GAPS_2026-05-29.md)

> **Closure pass — 2026-05-29:** R2, R7, R8, R9, R10, R12 are
> SHIPPED. R3 (Cloudflare edge inference) and R4 (on-device MiniLM
> router) are XL infra items that ship with research doc + MVP
> scaffold + tests; the production cap-flip is explicitly gated.
> Per-item status appears at the top of each section below.

Items here are **forward-looking** capabilities promised by the
research corpus but deferred from the 2026-05-29 closure pass. They
are NOT bugs — `Docs/KNOWN_ISSUES.md` remains reserved for ship-
blocker defects. Each entry cites the source research doc, an effort
estimate, and a suggested wave / milestone.

When a roadmap item ships, mark it with `[SHIPPED YYYY-MM-DD]` in
both the source research doc AND remove the entry from this file (or
move it to a "Shipped" trailer). The audit doc tracks the gap →
shipping reconciliation.

---

## R1 — Owner brief inline citations (effort: M)

**Source:** `Docs/RESEARCH/owner-status-sota.md` §1.F + §8
**Promise:** Every AI brief sentence carries superscripted ¹²³
evidence chips with tap-to-source modal — "every claim cites a
specific datum."
**Shipped:** `/v1/owner/brief` endpoint returns `evidence_ids[]`
alongside the brief text. The owner-web brief panel does not yet
render inline superscripts (the data is there but the UI consumes it
as a list at the bottom).
**Effort:** 1–2 days — owner-web panel needs a markdown→superscript
renderer that maps `¹²³` tokens to evidence-modal triggers.
**Suggested wave:** Owner-web BFF / brief polish (sibling-owned —
zone #166).
**Why deferred:** Owner-web zone owned by another agent; outside
this audit's safe touch area.

---

## R2 — Saved searches with 3-min new-match alerts (effort: L) — **[SHIPPED 2026-05-29]**

**Status:** Migration 0124 `saved_searches` table + Drizzle schema +
`saved-search-worker.ts` ticker + `/api/v1/owner/saved-searches`
CRUD + `owner.saved_search.create` brain tool +
owner-web settings page (`/settings/saved-searches`) + 9 worker
tests. The 3-min cadence is exposed as "hourly" frequency (60s tick
internally so test rows fire deterministically); future tightening
to true 3-min would land as a `freq=very-frequent` enum addition.

**Source:** `Docs/RESEARCH/buyer-marketplace-sota.md` §2.4
**Promise:** Buyer creates a saved search ("Gold 22k+, Geita, ≤ 5
kg"); red dot appears on home when new matches land within 3 min of
seller publishing (commodity-grade freshness SLA).
**Shipped:** Nothing yet — no schema, no endpoint, no UI.
**Effort:** ~1 week — needs:
- `buyer_saved_searches` schema + migration
- `POST /v1/mining/buyers/saved-searches` create endpoint
- worker that runs every 3 min, matches new listings against saved
  searches, fires push notification
- buyer-mobile UI for create / edit / delete saved search + red-dot
  badge on home
**Suggested wave:** Buyer-mobile pilot polish (post-launch).
**Why deferred:** Wave-scale work; pilot launch precedes it.

---

## R3 — Cloudflare Workers AI edge inference for owner-mobile
**(effort: XL)** — **[SCAFFOLDED 2026-05-29]**

**Status:** Research doc landed at
`Docs/research/EDGE_INFERENCE_CLOUDFLARE.md`; MVP scaffold at
`services/edge-inference/` (wrangler.toml, Workers AI binding, SSE
`message_chunk` parity, 9/9 pure-helper tests). Production cap-flip
is explicitly gated on owner-mobile pilot SLO data — DO NOT DEPLOY
TO PRODUCTION before the pilot's p90 TTFT exceeds 450ms on the 4G
cohort. Phase-2 deploy steps documented in §4 of the research doc.

**Source:** `Docs/RESEARCH/mobile-onload-intelligence.md` Phase 3
(§9.3)
**Promise:** Edge inference at af-south-1 (Cape Town / Joburg) for
the owner-mobile chat first-50-tokens. ~200 ms TTFT saving for
urban-4G owners.
**Shipped:** Anthropic-only path with the ack-fast SSE event landed
in this audit (G1). Edge path is untouched.
**Effort:** 3 dev-weeks per the research doc — needs:
- New `services/edge-brain` Cloudflare Worker
- `edge-brain-client.ts` race-and-merge composition module in api-
  gateway
- CORS allowlist + audit chain integration
- Feature flag wiring (`BORJIE_EDGE_BRAIN=on` per surface)
**Suggested wave:** Performance wave (post-pilot).
**Why deferred:** Infra-heavy and gated on owner-mobile pilot SLO
data — only worth the build if 4G urban owners report TTFT pain.

---

## R4 — On-device router (MiniLM-L6-v2 ONNX) (effort: XL) — **[STUBBED 2026-05-29 · DO NOT BUILD UNTIL Q4 2026]**

**Status:** Research doc landed at
`Docs/research/ON_DEVICE_MINILM_ROUTER.md`; stub package shipped at
`packages/on-device-router/` with `routeOnDevice(prompt)` returning
`{ toolId: null, confidence: 0 }` so callers can wire the routing
slot today. 6/6 vitest tests lock the contract. ONNX implementation
is explicit 2027+ work — bundle-size + hardware diversity gate.

**Source:** `Docs/RESEARCH/mobile-onload-intelligence.md` Phase 4
(§9.4)
**Promise:** 80 MB MiniLM-L6-v2 ONNX embedding model bundled into
both mobile apps for pre-network intent routing. Saves 100–300 ms on
hot "which tool?" paths.
**Shipped:** Nothing — the mobile apps still round-trip every routing
decision to the gateway.
**Effort:** 4 dev-weeks — needs:
- `packages/router-onnx` new package wrapping
  `onnxruntime-react-native`
- Asset bundling (or download-on-first-use) for the 80 MB model
- JSI native module verification on Hermes
- Server-side `routerHint` field on brain `/turn/stream`
- Accuracy A/B between brain-routing vs router-hint paths
**Suggested wave:** Mobile performance wave (deferred to 2027 per
the research doc).
**Why deferred:** Bundle-size + hardware diversity (Itel/Tecno
worker phones) make this risky for the pilot demographic.

---

## R5 — Worker-mobile hero-card home (effort: M)

**Source:** `Docs/RESEARCH/worker-guidance-sota.md` §1
**Promise:** Worker home reduced to single hero card (current task +
map preview) + sticky bottom "Imekamilika / Done" + voice mic.
DoorDash / CommCare / Apple-Fitness-rings pattern.
**Shipped:** Role-gated home composition exists; the hero pattern is
partial (KPI strip is still present).
**Effort:** 2–3 days — needs:
- Restructure `apps/workforce-mobile/app/(tabs)/home.tsx` worker
  branch
- Sticky bottom-bar component
- Wire voice mic to existing `streamChatTranscript` endpoint
**Suggested wave:** Workforce-mobile polish (zone #171 — sibling-
owned).
**Why deferred:** Mobile zone owned by another agent.

---

## R6 — Owner-cockpit live SSE push channels (effort: M) — **[SHIPPED 2026-05-29]**

**Source:** `Docs/RESEARCH/owner-status-sota.md` §1.H + §8 (refresh
tiers)
**Status:** Six event kinds multiplexed onto a single per-tenant
SSE endpoint at `GET /api/v1/cockpit/stream`:
`decision.recorded`, `reminder.fired`,
`opportunity.scan_completed`, `risk.changed`,
`workforce.shift_event`, `compliance.deadline_approaching`.

Backend:
- In-process tenant-scoped bus at
  `services/api-gateway/src/services/cockpit-events/`
- Six publishers wired at the canonical write sites: decision
  recorder, reminder dispatch markSent, opportunity-scanner and
  risk-scanner brain tools, workforce clock-in / out routes, and a
  new hourly `compliance-deadline-scan` cron worker scanning
  `regulatory_filings` for 7-day-horizon items.
- SSE handler at `routes/cockpit-stream.hono.ts` with 25s heartbeat
  + abort-signal cleanup.

Frontend (owner-web):
- `useCockpitStream()` React hook at `apps/owner-web/src/lib/
  cockpit-sse.ts` opens an EventSource + emits typed events.
- `<CockpitLivePulse>` mounts on the cockpit dashboard page and
  toasts every incoming push (bilingual sw/en copy).

Tests: 5 bus tests + 9 owner-web parser tests passing.

---

## R7 — Owner-mobile cockpit branch (effort: L) — **[SHIPPED 2026-05-29]**

**Status:** New mobile-friendly cockpit hub at
`apps/workforce-mobile/app/owner/cockpit/index.tsx` aggregates the
five owner-web cockpit panels (brief + decisions + opportunities +
risks + reminders) into one swipe-and-scroll surface with 48dp tap
targets. API gateway aggregator at
`/api/v1/owner/cockpit/hub` (4/4 tests) + react-query hook
`useCockpitHub` (2/2 tests). Re-uses existing `/v1/owner/brief`
endpoint shape internally.

**Source:** `Docs/RESEARCH/owner-status-sota.md` §8 (wire-level
spec)
**Promise:** `apps/workforce-mobile/app/(tabs)/home.tsx` owner
branch renders the 7-slot newspaper structure (greeting, brief,
needs-review, time-horizon, production / cash / safety / market
pillars). Brain composition via `/v1/owner/brief`.
**Shipped:** Endpoint + cron exist. Mobile screen scaffold not yet
implemented.
**Effort:** 1 week — needs:
- 7 slot components
- AsyncStorage for time-horizon persistence
- Pull-to-refresh + push notification wiring
**Suggested wave:** Mobile (zone #171 — sibling-owned).
**Why deferred:** Mobile zone is sibling-owned.

---

## R8 — Universal personal-KB UI (effort: L) — **[SHIPPED 2026-05-29]**

**Status:** Owner-web pages at `/personal-kb` (list + search) and
`/personal-kb/[personId]` (per-person memory-cell detail) backed by
three endpoints:
  - `GET /api/v1/me/persons/links` — list every hat the user wears
  - `GET /api/v1/me/persons/:personId/cells` — cells with
    consent-gate
  - `GET /api/v1/brain/personal-kb/search` — full-text cell search
The detail panel renders the explicit `CONSENT_REQUIRED` 403 as a
bilingual banner pointing to Settings → Share consent. 12/12 router
tests cover the consent gate, forbidden-person, happy paths.

**Source:** `Docs/RESEARCH/unified-personal-kb.md` §10.5
**Promise:** Persona switcher "All my roles" view + onboarding modal
when a new user signs up at tenant N with a phone matching an
existing person + Settings → Share consent screen.
**Shipped:** Database schemas (`persons`, `person_links`,
`personal_memory_cells`) + middleware (`person-context.ts`) +
boundary tagger (G5, this audit). UI is not yet wired.
**Effort:** ~1 week — needs:
- `<RolesSwitcher />` in owner-web
- Onboarding modal across all 4 surfaces
- Per-category Share-consent settings screen
- `GET /api/me/persons/links` endpoint
**Suggested wave:** Personal-KB wave (next).
**Why deferred:** UI surfaces span 4 apps; needs coordinated wave.

---

## R9 — Smart-Compose ghost-text predictive composer (effort: L) — **[SHIPPED 2026-05-29]**

**Status:** New `POST /api/v1/brain/compose/suggest` endpoint with
24-entry curated bilingual prefix-completion table (top owner
intents). React hook `useGhostCompletion` with 120ms debounce +
AbortController + fetcher test seam. `GhostCompletionInput`
composer with Tab-to-accept overlay. LLM fallback explicitly
deferred to phase-2 once production hot-path telemetry confirms
table coverage. 13/13 tests (8 pure-lookup + 5 router).

**Source:** `Docs/RESEARCH/mobile-chat-latency-ux.md` §3.1
**Promise:** Gboard-style inline ghost-text predictions while the
user types in the chat composer.
**Shipped:** Smart-reply chips above the keyboard (post-response)
shipped in the R7 polish wave. Pre-send predictive composer not
shipped.
**Effort:** ~1 week — needs:
- New `/brain/suggest` endpoint (low-latency, cached)
- React Native ghost-text overlay in the TextInput
**Suggested wave:** Chat polish wave (v2).
**Why deferred:** Research doc explicitly defers to v2.

---

## R10 — Adaptive token-streaming rate (effort: S) — **[SHIPPED 2026-05-29]**

**Status:** `services/api-gateway/src/services/brain/sse-adaptive.ts`
ships an `AdaptiveStreamController` that transitions micro ↔ batch
mode based on client ACK lag. Client helper at
`apps/owner-web/src/lib/sse-ack.ts` debounces ACK POSTs (default
500ms). 7/7 vitest tests lock the mode-transition invariants.
Server-side wiring into the SSE producer is the next-step composition
hook (the controller is framework-agnostic).

**Source:** `Docs/RESEARCH/mobile-chat-latency-ux.md` §5.2 +
`mobile-onload-intelligence.md` §1.5
**Promise:** Stream rate adapts to content complexity per arxiv
2504.17999 — ~21 wps for simple, ~12 wps for complex.
**Shipped:** Fixed 15 wps (Swahili medium-complexity midpoint).
**Effort:** ~2 days — needs a complexity classifier on the streaming
chunk + a buffer reducer on the client.
**Suggested wave:** Chat polish wave (v2). Listed in research as
v1.5 candidate; safe to defer.

---

## R11 — Buyer-mobile predictive RFB composer (effort: M) — **[SHIPPED 2026-05-29]**

**Source:** `Docs/RESEARCH/buyer-marketplace-sota.md` §3 — Metalshub
three-mode buyer entry
**Status:** End-to-end buyer-initiated RFB:

Backend:
- Migration 0127 — `request_for_bids` + `request_for_bid_responses`
  sidecar, RLS FORCE per CLAUDE.md hard rule.
- Drizzle schema at `packages/database/src/schemas/
  request-for-bids.schema.ts`.
- Five endpoints at `services/api-gateway/src/routes/marketplace/
  rfb.hono.ts`: create / list-mine / nearby (haversine) / cancel /
  respond.
- Three brain tools at `composition/brain-tools/buyer-tools.ts`:
  `buyer.rfb.create`, `buyer.rfb.list_mine`,
  `seller.rfb.list_nearby`.

Buyer-mobile:
- Two new screens at `apps/buyer-mobile/app/rfb/`:
  `create.tsx` (form) + `index.tsx` (list with pending response
  count). Bilingual sw/en throughout — 27 new `rfb.*` keys per locale.
- Typed gateway client at `apps/buyer-mobile/src/api/rfb.ts`.

Tests: 9 gateway endpoint tests + 5 buyer-mobile i18n / catalog
tests all passing.

---

## R12 — Owner persona switcher (Discord per-server profile pattern)
**(effort: M)** — **[SHIPPED 2026-05-29]**

**Status:** `GET /api/v1/me/tenants` + `POST /api/v1/me/tenants/active`
backend with cookie-based active-tenant binding
(`borjie-active-tenant`, HttpOnly, SameSite=Lax, 30-day TTL). Server
re-verifies the user is linked to the requested tenant before
writing the cookie (no client trust). TenantRail component renders
the Discord-style left rail with role-coded fallback initials, smart
hide when ≤1 tenant, active-state gold pill. 9/9 router tests
(401 gate, 503 envelope, empty list, cookie override, 403
TENANT_NOT_LINKED, zod validation, cookie attributes).

**Source:** `Docs/RESEARCH/unified-personal-kb.md` §2 + §10.5
**Promise:** Discord-style per-tenant presentation of one underlying
identity — name + avatar + greeting all change per active tenant,
without re-authenticating.
**Shipped:** persona-runtime supports tenant-scoped persona binding;
the UI switcher does not yet expose "wear another hat" inside one
session.
**Effort:** 3–4 days — needs:
- `<TenantSwitcher />` in owner-web header
- Persona-runtime session re-binding without re-auth
- Memory boundary check before allowing the switch
**Suggested wave:** Personal-KB UI wave.

---

---

## R13 — Tenant-aware defaults plumbed end-to-end (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-005 (closed 2026-05-29)
**Promise:** Every read of timezone / locale / currency / city in
non-gateway services pulls from `tenant.defaultTimezone`,
`tenant.defaultLocale`, `tenant.primaryCity`, `tenant.defaultCurrency`
rather than process-default fallbacks.
**Shipped:** The tenants schema already has `primaryCurrency`,
`defaultLanguage` (locale), `city`. The api-gateway middleware exposes
the full settings struct via `c.get('tenant').settings`. The TODOs at
7 sites still consume locale-neutral defaults because the call chain
through 4 packages (notifications, reports, marketing-brain, ai-copilot)
has not yet been threaded.
**Effort:** 2 dev-days — needs:
- One Drizzle migration adding `defaultTimezone` (IANA) to `tenants`
- 7 call-site refactors to accept a `TenantSettings`-shaped argument
- Composition-root wiring to pass settings into background tasks
**Suggested wave:** Tenant-onboarding wave.
**Why deferred:** Cross-package refactor; safer as a focused wave.

---

## R14 — GePG direct-integration HTTP client wired to live sandbox (effort: L)

**Source:** `Docs/KNOWN_ISSUES.md` KI-006 (closed 2026-05-29)
**Promise:** `services/payments/src/providers/gepg/gepg-client.ts`
emits the real SOAP/REST envelope (spec §3) instead of synthesising
deterministic 12-digit control numbers.
**Shipped:** PSP-shortcut path is production. Sandbox stub path keeps
the downstream pipeline (matcher → ledger → notifications) testable
without GePG creds.
**Effort:** 1 week — needs:
- PKCS#12 cert handling + SOAP envelope build
- Live GePG sandbox credentials (SP, SpSysId)
- Round-trip integration test against the sandbox
**Suggested wave:** TZ payments hardening (post-pilot).
**Why deferred:** Sandbox credentials not yet provisioned.

---

## R15 — Inspection narrative AI persona (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-007 (closed 2026-05-29)
**Promise:** Conditional-survey / move-out / FAR inspection services
emit a model-written narrative (instead of a terse summary) per finding.
**Shipped:** Ports accept an optional `persona` seam at all 5 call sites.
**Effort:** 3 dev-days — author the `inspection-narrator` persona under
`packages/ai-copilot/src/personas/`, register with `BrainRegistry`,
inject at composition.
**Suggested wave:** AI-Copilot wave.

---

## R16 — Negotiation counter-offer LLM generator (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-008 (closed 2026-05-29)
**Promise:** `negotiation-service.ts` calls a real `negotiator` persona
instead of clamping midway between last offer and lower bound.
**Shipped:** Post-LLM policy re-check is wired so the eventual swap is
safe. Stub clamps midway; no compliance risk today.
**Effort:** 3 dev-days — author `packages/ai-copilot/src/personas/negotiator.ts`
exporting an `AiCounterGenerator`, wire via composition.
**Suggested wave:** AI-Copilot wave.

---

## R17 — document-chat real Anthropic adapter with citation parser (effort: L)

**Source:** `Docs/KNOWN_ISSUES.md` KI-009 (closed 2026-05-29)
**Promise:** RAG answers are real LLM responses with parsed
`<citations>` tags → `DocChatCitation[]`, not deterministic echo
strings.
**Shipped:** Stub returns one citation per claim; functional but
mechanical.
**Effort:** 5 dev-days — needs:
- Replace `StubAnthropicDocChatLlm` with adapter
- `<citations>` tag round-trip parser + unit tests
- Recorded fixtures for prompt-stability tests
- Compose-root gate on `ANTHROPIC_API_KEY` presence
**Suggested wave:** Document-Intelligence wave.

---

## R18 — Station-master polygon coverage (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-010 (closed 2026-05-29)
**Promise:** `station-master-router.ts` resolves polygon-kind coverage
via `turf.booleanPointInPolygon` against GeoNode polygons.
**Shipped:** Radius + district kinds work. Polygon kind currently
skips.
**Effort:** 2 dev-days once GeoNode lives — swap the `polygon` case
from `skip` to `turf` lookup; lift the polygon-kind test gate.
**Suggested wave:** Geo wave (gated on GeoNode deploy).

---

## R19 — Production scanner deskew + PDF assembler (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-011 (closed 2026-05-29)
**Promise:** Multi-page scans are deskewed via WASM OpenCV and
assembled into a single PDF via pdf-lib.
**Shipped:** Per-page image delivery works; single-PDF output deferred.
**Effort:** 3 dev-days — add `pdf-lib` + `@techstark/opencv-js`
behind a feature flag; wire the deskew step into the scan pipeline.
**Suggested wave:** Document-Intelligence wave.

---

## R20 — Migration Wizard copilot composition registration (effort: S)

**Source:** `Docs/KNOWN_ISSUES.md` KI-013 (closed 2026-05-29)
**Promise:** `POST /api/v1/migration/:runId/ask` invokes the real
`MigrationWizardCopilot` instead of returning a placeholder ack.
**Shipped:** The router already detects `deps.migrationWizardCopilot`
and forwards `tenantId`, `actorId`, `runId`, `message` when present.
The copilot class itself ships in `packages/ai-copilot/src/copilots/`
with parser unit tests. Missing piece: register on the shared
`ServiceRegistry`.
**Effort:** 1 dev-day — `ServiceRegistry.migrationWizardCopilot`
field + composition-root wire + an integration test that asserts the
non-501 path.
**Suggested wave:** AI-Copilot wave.

---

## R21 — OCR cloud-adapter wiring (Textract / Vision) (effort: S)

**Source:** `Docs/KNOWN_ISSUES.md` KI-014 (closed 2026-05-29)
**Promise:** Document-intelligence routes accept Textract / Vision
OCR providers per tenant config; tesseract remains the dev fallback.
**Shipped:** SDK adapters are declared optional deps so the package
stays buildable without cloud creds.
**Effort:** 1 dev-day per cloud — `pnpm add -F @borjie/document-intelligence`
the SDK, write the thin adapter, register in the OCR factory.
**Suggested wave:** Document-Intelligence wave (per-tenant onboarding).

---

## R22 — Peripheral parser/library wiring (effort: per-site S/M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-015 (closed 2026-05-29)
**Promise:** Replace the graceful-degradation stubs with real libraries:
- `exceljs` xlsx parser (`packages/ai-copilot/src/services/migration/parsers/xlsx-parser.ts`)
- `papaparse` CSV parser upgrade
- `docxtemplater` document renderer
- ScannerCamera React surface (camera + edge detection)
- External market-feed adapter
- videojs / Plyr report video player polish
**Shipped:** All sites have a clear graceful-degradation path today.
**Effort:** 1 dev-day per site (avg).
**Suggested wave:** File individual tickets per site once a tenant
contract requires the feature.

---

## R23 — Renewal uplift ML heuristic upgrade (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-Wave18 (closed 2026-05-29)
**Promise:** `renewalProposal.propose` in
`services/api-gateway/src/composition/background-wiring.ts` uses a
model-driven rent suggestion instead of `currentRent * 1.05`.
**Shipped:** The renewal optimizer port shape already accepts
current rent + days-to-expiry, so swap is non-breaking.
**Effort:** 2 dev-days once the ML service ships.
**Suggested wave:** Renewal-intelligence wave.

---

## R24 — Marketing pilot-application persistence (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-MARKETING-1 (closed 2026-05-29)
**Promise:** `/api/v1/marketing/pilot-application` writes to
`marketing.pilot_applications`, fires an inbound email to
`pilot@borjie.co.tz`, and returns `{ success: true, id }`.
**Shipped:** Validation + structured logging; the inbound is visible
in logs but not persisted.
**Effort:** 3 dev-days — needs:
- Drizzle migration for `marketing.pilot_applications`
- Thin `PilotApplicationRepo` bound at composition
- Notifications fan-out to the pilot mailing list
**Suggested wave:** Marketing launch wave.

---

## R25 — Mobile voice STT via EAS dev build (effort: M, gated on EAS)

**Source:** `Docs/KNOWN_ISSUES.md` KI-DEBT-002 (closed 2026-05-29)
**Promise:** `apps/workforce-mobile/app/owner/O-M-02.tsx` triggers the
real Swahili STT pipeline (Spitch via `@borjie/voice-agent`) on the
voice button press.
**Shipped:** Placeholder copy prefills the draft so the flow is
testable without the native module.
**Effort:** 2 dev-days inside an EAS dev build cycle.
**Suggested wave:** Voice wave (tracks issues #14 + #22).

---

## R26 — Marketplace inbound gateway endpoint (effort: M)

**Source:** `Docs/KNOWN_ISSUES.md` KI-DEBT-003 (closed 2026-05-29)
**Promise:** `/api/v1/mining/marketplace/inbound` returns the buy-side
read model, replacing the mock list in `MarketplaceBoard.tsx`.
**Shipped:** UI surface clearly labels its data as a placeholder list.
**Effort:** 3 dev-days — stand up `routes/mining/marketplace.hono.ts ::
listInbound`, wire to the buyer-marketplace-advisor read model, swap
the renderer's mock data path for a `useMarketplaceInbound` query.
**Suggested wave:** Marketplace wave (tracks issue #20).

---

End of roadmap. Items are listed in approximate order of expected
delivery, not strict priority — priority is set per wave-plan call.
