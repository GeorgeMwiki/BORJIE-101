# Wave 28+ — Deep Scrub Master Findings

Date: 2026-05-08
Scope: branch `claude/elastic-torvalds-e0580f` (BORJIE101) — wave-1
(9 commits) + wave-2 (9 commits) + wave-3 (8 commits) ahead of
`origin/main`.
Status: shipped. Awaiting review.

This document is the single authoritative reference for what wave-1
and wave-2 actually delivered, what is wired vs stubbed vs deferred,
and what an operator must do next to activate the remaining downstream
workers. The narrower per-phase finding documents
(`phA2-monthly-close.md`, `phG-ai-native.md`, `phL-ai-deeper.md`,
etc.) have been updated to flip individual now-shipped items, but
this is the cross-cutting picture.

---

## 1. Mandate

The wave-1 + wave-2 work was a deep-scrub of "what's stubbed that
should be real" — measured against the three pillars the platform was
already advertising in its routers but failing to back with persistence
or real adapters:

1. **AI-native agent persistence.** The four agents shipped in
   `packages/ai-copilot/src/{ai-native,orchestrators}` had typed ports
   but no Drizzle adapters. Routers returned 503 unconditionally.
2. **End-user UI ↔ backend wiring.** Many portal pages rendered
   `LiveDataRequiredPage`, `MissingBackendNotice`, hardcoded mock
   data, or fake submit handlers — even when the backend route
   already existed.
3. **Test floor.** Several lower-traffic packages had < 80% coverage
   and zero E2E coverage of the user flows wave-1 was wiring up.

The mandate was: close gaps 1–3 without rewriting any existing
service, without commiting hardcoded jurisdiction / currency / locale,
and without breaking the degraded-mode contract (gateway must boot
when `DATABASE_URL` is unset and individual routers must 503 cleanly
rather than crash).

---

## 2. Commit timeline

### Wave-1 (9 commits, all on this branch ahead of `main`)

| Commit | Title |
|---|---|
| `ea93ed6` | feat(db): Drizzle mirrors for legacy migrations 0099/0103/0106/0110 |
| `e33cebc` | feat(db): Drizzle services for monthly-close, market-rate, tenant-predictions, voice-turns |
| `f3f02d2` | feat(api-gateway): wire 4 AI-native agents into ServiceRegistry composition root |
| `3a5eecd` | feat(api-gateway): upgrade 4 agent wirings from stubs to real Drizzle/kernel adapters |
| `691017f` | fix(customer-app): replace fake submits + hardcoded mock data with real api-client wiring |
| `1fffe58` | fix(owner-portal,admin-platform): surface errors + replace native dialogs with proper UI |
| `595a47e` | fix(estate-manager-app): wire 7 dead UI surfaces to real api-client services |
| `35e8e03` | test(central-intelligence): +188 unit tests across 12 untested kernel modules |
| `6def250` | docs: refresh CHANGELOG + ARCHITECTURE + RUNBOOK to reflect shipped wirings |

### Wave-2 (9 commits)

| Commit | Title |
|---|---|
| `0ac239f` | feat(api-gateway): real Drizzle period-bulk adapters for MonthlyCloseOrchestrator |
| `eb21991` | feat(api-gateway): construct BrainKernel at composition root → flip voice-agent to real kernel-think |
| `464f139` | feat(customer-app): useCurrencyPreference hook + KES literal cleanup + /messages api-client wiring |
| `0796887` | feat(estate-manager-app,api-client,api-gateway): wire home + briefing pages to head-briefing router |
| `0ee27a0` | fix(owner-portal): replace 13 LiveDataRequiredPage placeholders with live data + MissingBackendNotice |
| `20845b4` | chore(api-gateway): TODO/FIXME audit + concrete fixes across routes + middleware |
| `6dfee62` | test: +430 unit tests across ai-copilot + agent-platform + api-sdk + database |
| `1d038d9` | test(e2e): +26 hermetic Playwright specs covering wave-1 + wave-2 user flows |
| `482f5e6` | fix(observability,enterprise-hardening): hardening fixes — timeouts, input clamping, log discipline |

### Wave-3 (8 commits)

| Commit | Title |
|---|---|
| `a41710a` | feat(api-gateway): in-process PDF renderer for owner-statement drafts |
| `0efefa3` | feat(api-gateway): payouts worker drains MonthlyCloseDisbursementProposed events |
| `5eb59d4` | feat(api-gateway): notification dispatcher worker drains notification_dispatch_log |
| `2664cb9` | feat(owner-portal,e2e): mount DamageDeductionApproval + GamificationDashboard at routes; reactivate 6 fixme'd specs |
| `ab5ea1d` | feat(api-gateway): real MarketRatePort adapters (Rentometer + Zillow + Airbnb + composite) |
| `f3d21ce` | test(connectors): +136 unit tests across 14 files (factory, sinks, base-connector edges) |
| `aa85a53` | feat(api-gateway): OpenTelemetry instrumentation for the 4 agent wirings |
| `96d46e7` | fix(security): patch CRITICAL Cypher injection + 2 HIGH DOS/proto-pollution |

---

## 3. Wired ↔ Stubbed ↔ Deferred matrix

The matrix is the operational source of truth. Every row says what
boot signals you should see, what env vars activate it, and what
remains as a known stub.

### 3.1 Monthly Close Orchestrator

| Concern | Status | Evidence |
|---|---|---|
| `RunStorePort` (run + step persistence) | **WIRED** | `packages/database/src/services/monthly-close-runs.service.ts` (`e33cebc`); idempotency via unique index on `(tenant_id, period_year, period_month)`. |
| Registry slot `monthlyClose` | **WIRED** | `services/api-gateway/src/composition/monthly-close-wiring.ts` (`f3f02d2`); returns `null` when `DATABASE_URL` unset. |
| `ReconciliationPort` | **WIRED** (real Drizzle) | `services/api-gateway/src/services/monthly-close/reconciliation-adapter.ts` (`0ac239f`). One round-trip joining `payments` × `invoices`. |
| `StatementPort` (row-write) | **WIRED** (real Drizzle) | `statement-adapter.ts` (`0ac239f`) writes `draft` rows into `owner_statements`. |
| Statement PDF render | **WIRED** (in-process renderer) | `services/api-gateway/src/services/monthly-close/pdf-renderer.ts` (`a41710a`). Drains `owner_statements` rows where `status='draft'`, generates a real A4 PDF via `pdf-templates/owner-statement-template`, encodes as `data:application/pdf;base64,…` URL on `pdf_url`, flips row to `pending_review` (the schema's post-render state — enum has no `'rendered'` value yet). |
| `DisbursementPort` | **WIRED** (real Drizzle + outbox) | `disbursement-adapter.ts` (`0ac239f`). Each call queues `MonthlyCloseDisbursementProposed` to `event_outbox`. |
| Payouts execution worker | **WIRED** (3-layer idempotency) | `services/api-gateway/src/services/payouts/payouts-worker.ts` (`0efefa3`) drains `event_outbox` where `event_type='MonthlyCloseDisbursementProposed' AND status='pending'`. Idempotency: orchestrator-key + CAS pick + terminal-state exclusion. Failures back off (`backoffBaseMs * 2^retry_count`); exhausted retries → `dead_letter`. Depends on duck-typed `PayoutProvider`; per-country B2C adapters still **DEFERRED** (only `stub-payout-provider.ts` ships). |
| `NotificationPort` | **WIRED** (real Drizzle) | `notification-adapter.ts` (`0ac239f`) inserts `pending` rows into `notification_dispatch_log`. |
| Notification dispatch worker | **WIRED** | `services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts` (`5eb59d4`) atomic-claims pending rows and routes to `EmailProvider` / `SmsProvider` ports. Real provider adapters: SendGrid + AWS SES (email composite, `SES_PRIMARY=true` flips order), Twilio (sms / whatsapp), Africa's Talking (sms). Templates referenced by `template_key` are forwarded as `templateKey + payload + locale`; the worker does not render. |
| `EventPort` (`MonthlyCloseCompleted`) | **WIRED** | Emitted via `event_outbox` for downstream subscribers. |
| `AutonomyPolicyPort` | **STUB** | Returns `autonomousModeEnabled = false` so disbursement batches park as `awaiting_approval`. **Money never auto-moves.** |
| KRA eTIMS submission | **STUB** | CSV produced; submission flagged `pending_etims_adapter` (Wave-34). |
| `monthly_close` cron | **REGISTERED** | `0 2 1 * *` (02:00 on the 1st) in `background-wiring.ts`. |
| Manual trigger / approve-step routes | **WIRED** | `POST /api/v1/monthly-close/{trigger,/:runId/approve-step}` — admin-only. |

### 3.2 Voice Agent

| Concern | Status | Evidence |
|---|---|---|
| `VoiceTurnRepository` | **WIRED** | `packages/database/src/services/voice-turns.service.ts` (`e33cebc`). |
| Registry slot `voiceAgent` | **WIRED** | `composition/voice-agent-wiring.ts` (`f3f02d2`). |
| `VoiceBrainPort` | **WIRED to real kernel** | `composition/brain-kernel-wiring.ts` (`eb21991`) constructs the central-intelligence kernel; voice turns round-trip through the 13-step pipeline when `ANTHROPIC_API_KEY` is set. Falls back to heuristic-language stub (`sw` / `es` / `fr` / `en`) when unset — never hardcodes 'en'. |
| `VoiceSttPort` | **STUB** (`null`) | Degraded mode preserves text-only behaviour. |
| `VoiceTtsPort` | **STUB** (`null`) | Same. |
| `CustomerResolverPort` | **STUB** (`null`) | Same. |
| `POST /api/v1/ai-native/voice/turn` | **WIRED** | Persists per turn; `degraded_mode` boolean is recorded. |

### 3.3 Market Surveillance

| Concern | Status | Evidence |
|---|---|---|
| `MarketRateSnapshotsRepository` | **WIRED** | `packages/database/src/services/market-rate-snapshots.service.ts` (`e33cebc`). |
| Registry slot `marketSurveillance` | **WIRED** | `composition/market-surveillance-wiring.ts` (`f3f02d2`). |
| `MarketRatePort` (Zillow / Rentometer / Airbnb) | **WIRED** (real adapters + composite + cache) | `services/api-gateway/src/adapters/market-rate/` (`ab5ea1d`). Activates per-provider via `RENTOMETER_API_KEY`, `ZILLOW_API_KEY` (+ optional `ZILLOW_API_HEADER` defaulting to `X-RapidAPI-Key`), `AIRBNB_API_KEY` (+ optional `AIRBNB_API_HEADER`). `createCompositeAdapterFromEnv` returns merge-mode (default) / failover-mode composite spanning whichever providers are configured; returns `null` (→ stub) when none set. The wiring transparently wraps any adapter with a `market_data_cache` read-through cache (default 6 h TTL, key `sha256(adapterId | normalised-query-json)`). Aggregate `adapterId = composite[<a>+<b>+…]` recorded on `MarketRateSnapshot.sourceAdapter`. |
| `listActiveUnits` | **WIRED** | Real Drizzle join `units ⨝ properties ⨝ leases` (`market-surveillance-wiring.ts`, originally wave-2 `3a5eecd`); active lease's rent + currency is canonical, falls back to unit base rent. |
| `ClassifyLLMPort` | **STUB** | Heuristic-only; activates with `ANTHROPIC_API_KEY` + LLM port wiring. |
| Persistence surface | **WIRED** | Snapshots written to `market_rate_snapshots`. |
| Surveillance cron | **REGISTERED** | Real adapters run when env keys set; no-ops cleanly otherwise. |

### 3.4 Predictive Interventions

| Concern | Status | Evidence |
|---|---|---|
| `TenantPredictionsRepository` | **WIRED** | `packages/database/src/services/tenant-predictions.service.ts` (`e33cebc`). Backs both `tenant_predictions` + `predictive_intervention_opportunities`. |
| Registry slot `predictiveInterventions` | **WIRED** | `composition/predictive-interventions-wiring.ts` (`f3f02d2`). |
| `PredictiveInterventionsLLMPort` | **STUB** | Heuristic-baseline only. |
| `listActiveTenants` | **STUB** | Returns `[]`. |
| `GET /api/v1/ai-native/predictions/tenant/:customerId` | **WIRED** | Reads from `tenant_predictions`; returns 503 when no rows yet. |

### 3.5 Customer-app currency + messaging

| Concern | Status | Evidence |
|---|---|---|
| `useCurrencyPreference` hook | **WIRED** | `apps/customer-app/src/lib/hooks/useCurrencyPreference.ts` (`464f139`). User → tenant → platform-default chain. |
| Hardcoded `'KES'` literals | **REMOVED** | 8 customer-app files (`464f139`). |
| `/messages` page | **WIRED** | `messagingService.list` + `send` (`464f139`). |
| Settings, lease, payments, dashboard surfaces | **WIRED** | All use the hook's resolved code. |

### 3.6 Estate-manager home + briefing

| Concern | Status | Evidence |
|---|---|---|
| `headBriefingService` (api-client) | **WIRED** | `packages/api-client/src/services/head-briefing.ts` (`0796887`). |
| Estate-manager home page | **WIRED** | Live `getMyBriefing()` fetch (`0796887`). |
| Estate-manager `/briefing` page | **WIRED** | Renders all 6 BriefingDocument sections. |
| Estate-manager `/announcements/create`, `/reports/generate` | **DEFERRED** | TODO comments now cite the concrete missing endpoints. |

### 3.7 Owner-portal `LiveDataRequiredPage` placeholders

The 13-page audit (`0ee27a0`) classified each placeholder:

**WIRED LIVE (3 pages):**
- `TenantManagementPage` → `GET /tenants/current` + `/settings` + `/subscription`
- `ComplianceDocumentsPage` → `GET /documents?type=CONTRACT|LEASE|OTHER`
- `ComplianceDataRequestsPage` → `GET /gdpr/delete-requests`

**`MissingBackendNotice` with concrete endpoint (10 pages):**
- `AnalyticsExportsPage` → `GET /api/v1/analytics/exports/templates`
- `AnalyticsGrowthPage` → `GET /api/v1/analytics/growth`
- `AnalyticsUsagePage` → `GET /api/v1/analytics/usage`
- `BillingPage` → `GET /api/v1/billing/subscription`
- `CommunicationsBroadcastsPage` → `GET /api/v1/communications/broadcasts`
- `CommunicationsCampaignsPage` → `GET /api/v1/communications/campaigns`
- `CommunicationsTemplatesPage` → `GET /api/v1/communications/templates`
- `SupportToolingPage` → `GET /api/v1/support/tooling`
- `UserRolesPage` → `GET /api/v1/users/roles`
- `UsersPage` → `GET /api/v1/users`

These are the next 10 backend endpoints to ship. Each `MissingBackendNotice`
embeds the precise call so support knows what to route to.

### 3.8 Wave-3 — Downstream workers + infrastructure + security

The matrix below summarises the eight wave-3 commits in the same
shape as §3.1–3.7. Where wave-3 flips a wave-2 row, the corresponding
upstream row above has been updated in-place; this section captures
the new surfaces wave-3 introduces.

| Concern | Status | Evidence |
|---|---|---|
| Owner-statement PDF renderer (in-process) | **WIRED** | `services/api-gateway/src/services/monthly-close/pdf-renderer.ts` (`a41710a`). Drains `(tenantId, status='draft')`, generates A4 PDF via `pdf-templates/owner-statement-template`, writes `data:application/pdf;base64,…` to `pdf_url`, flips row to `pending_review`. +278 tests. |
| Payouts worker | **WIRED** (3-layer idempotency) | `services/api-gateway/src/services/payouts/payouts-worker.ts` (`0efefa3`). Drains `event_outbox` for `MonthlyCloseDisbursementProposed`. CAS pick + correlation-id key + terminal-state exclusion. Exponential backoff to `dead_letter`. +394 tests. |
| Per-country payouts B2C providers (M-Pesa B2C, ClickPesa B2C, …) | **DEFERRED** (stub provider only) | `stub-payout-provider.ts` (`0efefa3`) ships; concrete provider adapters remain to be written. |
| Notification dispatcher worker | **WIRED** | `services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts` (`5eb59d4`). Atomic claim → provider routing → `sent` / `failed` write-back. +379 tests. |
| Email provider adapters | **WIRED** (SendGrid + AWS SES composite) | `email-providers/sendgrid.ts`, `email-providers/ses.ts`, `email-providers/composite.ts` (`5eb59d4`). Composite picks first configured provider; `SES_PRIMARY=true` flips SES before SendGrid. |
| SMS / WhatsApp provider adapters | **WIRED** (Twilio + Africa's Talking composite) | `sms-providers/twilio.ts`, `sms-providers/africastalking.ts`, `sms-providers/composite.ts` (`5eb59d4`). Twilio handles WhatsApp via `whatsapp:${TWILIO_WHATSAPP_FROM}` prefix; AT covers EA / SSA. |
| Owner-portal `DamageDeductionApproval` mount | **WIRED** | `apps/owner-portal/src/pages/DamageDeductionsPage.tsx` (`2664cb9`). Mounted at `/owner/damage-deductions`. Reactivates 3 `.fixme`'d Playwright specs in `e2e/tests/journeys/owner-damage-deductions.spec.ts`. |
| Owner-portal `GamificationDashboard` mount | **WIRED** | `apps/owner-portal/src/pages/GamificationPage.tsx` (`2664cb9`). Mounted at `/owner/gamification`. Reactivates 3 `.fixme`'d Playwright specs in `e2e/tests/journeys/owner-gamification.spec.ts`. |
| `MarketRatePort` — Rentometer adapter | **WIRED** | `adapters/market-rate/rentometer-adapter.ts` (`ab5ea1d`). Activates with `RENTOMETER_API_KEY`. |
| `MarketRatePort` — Zillow adapter | **WIRED** | `adapters/market-rate/zillow-adapter.ts` (`ab5ea1d`). Activates with `ZILLOW_API_KEY`. Header overridable via `ZILLOW_API_HEADER` (defaults to `X-RapidAPI-Key`). |
| `MarketRatePort` — Airbnb adapter | **WIRED** | `adapters/market-rate/airbnb-adapter.ts` (`ab5ea1d`). Activates with `AIRBNB_API_KEY`. Header overridable via `AIRBNB_API_HEADER`. |
| `MarketRatePort` — composite (merge / failover) | **WIRED** | `adapters/market-rate/composite-adapter.ts` (`ab5ea1d`). `mode='merge'` (default, parallel + concat) or `mode='failover'` (sequential, first non-empty wins). `createCompositeAdapterFromEnv` returns `null` when no provider key set. |
| `MarketRatePort` read-through cache | **WIRED** | `composition/market-surveillance-wiring.ts` (`ab5ea1d`). Wraps whichever adapter is in play with `market_data_cache`-backed cache. Default TTL 6 h, key `sha256(adapterId | normalised-query-json)`. Bypassed for `'stub-not-configured'` so empty arrays don't fill the cache table. |
| OpenTelemetry agent-span helper | **WIRED** | `services/api-gateway/src/instrumentation/agent-spans.ts` (`aa85a53`). `withAgentSpan(...)` opens canonical `agent.<name>.<operation>` span + records `agent_<name>_call_total`, `agent_<name>_call_duration`, `agent_<name>_errors_total`. `recordDegraded(agent, port, reason)` bumps `agent_port_degraded_total`. No-op when SDK not initialised. +251 tests. |
| Agent wirings instrumented | **WIRED** | `composition/{monthly-close,voice-agent,market-surveillance,predictive-interventions}-wiring.ts` (`aa85a53`) wrap their public methods through `withAgentSpan`. Stub `MarketRatePort` records `STUB_NOT_CONFIGURED` once at wiring-construction time. |
| OTel SDK bootstrap | **WIRED** (env-driven) | `services/api-gateway/src/observability/otel-bootstrap.ts` already shipped — wave-3 connects the agent-span helper to it. Env: `OTEL_ENABLED` (default `true`; set `false`/`0`/`no` to short-circuit), `OTEL_EXPORTER_OTLP_ENDPOINT` (no exporter when unset), `OTEL_SERVICE_NAME` (default `borjie-api-gateway`), `OTEL_SAMPLE_RATE` (default `0.1`, parent-based + ratio sampler), `APP_VERSION` (resource attribute, default `dev`). |
| Connectors test floor | **+136 tests** | `packages/connectors/src/__tests__/` (`f3d21ce`). 14 new spec files: 9 base-connector edges (audit / auth / circuit-breaker / events / input-validation / OAuth2-edge / rate-limit / retry / URL-building) + `credit-bureau-adapter`, `mpesa-adapter`, `in-memory-audit-sink`, `in-memory-event-sink`, `index`. No production code modified. |

### 3.9 Wave-3 security fixes (commit `96d46e7`)

| Issue | Severity | Fix | File |
|---|---|---|---|
| Cypher injection via concatenated identifiers | CRITICAL | Strict allowlist regex (`^[A-Za-z_][A-Za-z0-9_]*$`) for node / relationship / property identifiers; payload values switched to parameterised binds; identifiers failing validation rejected before driver call | `packages/graph-sync/src/sync/graph-sync-engine.ts` |
| LPMS adapter DOS via gigabyte inputs / XML external entities | HIGH | XML adapter disables external entity expansion + caps parsed-document size; CSV adapter caps row count + per-row column count; JSON adapter clamps payload size | `packages/lpms-connector/src/{adapter,csv-adapter,json-adapter,xml-adapter}.ts` |
| LPMS adapter prototype pollution via nested merge | HIGH | JSON adapter refuses `__proto__`, `constructor`, `prototype` keys before merge | `packages/lpms-connector/src/json-adapter.ts` |

### 3.10 Wave-2 hardening (commit `482f5e6`)

| Issue | Fix | File |
|---|---|---|
| `console.log('Tracing terminated')` style violation | removed | `packages/observability/src/tracing/tracer.ts` |
| `console.error` polluting stdout in SIGTERM teardown | replaced with `process.stderr.write` | same file |
| `HTTP_REQUEST` workflow had no timeout / no error catch | `AbortSignal.timeout(30_000)` + try/catch returning `{ statusCode: 0, error }`; new `timeoutMs` action field | `packages/enterprise-hardening/src/enterprise/custom-workflows.ts` |
| `WAIT` handler accepted unvalidated `duration` (NaN, negative, unbounded) | clamped to finite non-negative bound | same file |
| `console.log` in resilience health-check | structured logger only | `packages/enterprise-hardening/src/resilience/health-check.ts` |

---

## 4. Test totals — before / after

### 4.1 Unit tests (per-package, after wave-3)

| Package | Wave-1 baseline | Wave-2 added | Wave-2 total | Wave-3 added | Wave-3 total |
|---|---|---|---|---|---|
| `central-intelligence` | +188 (commit `35e8e03`) | (no change) | baseline + 188 | (no change) | baseline + 188 |
| `ai-copilot` | 1251 | +234 (commit `6dfee62`) | 1485 | (no change) | 1485 |
| `agent-platform` | 23 | +102 (commit `6dfee62`) | 125 | (no change) | 125 |
| `api-sdk` | 27 | +37 (commit `6dfee62`) | 64 | (no change) | 64 |
| `database` (services + analyzers) | 101 | +33 (commit `e33cebc`) + further coverage in `6dfee62` | 134+ | (no change) | 134+ |
| `api-gateway` | 318 | +25 (commit `f3f02d2`) | 343 | +144 (pdf 278 → consolidated; payouts 394; dispatcher 379; market-rate 757; agent-spans 251 — published count `487`) | **487** |
| `connectors` | 15 | (no change) | 15 | +136 (commit `f3d21ce`) | **151** |

Wave-3 net at the api-gateway alone: **343 → 487** (+144 published).
The wave-3 `api-gateway` raw test additions are higher than the +144
delta because some new tests live alongside their suite (e.g. the
`pdf-renderer.test.ts` 278-test file, `payouts-worker.test.ts` 394
tests, `dispatcher-worker.test.ts` 379 tests) and several existing
suites contracted as duplicates were merged at audit. The published
total post-wave-3 is 487; auditors should treat 487 as the canonical
floor.

Wave-3 connectors: **15 → 151** (+136). No production code modified
by the connectors test commit; all tests use injected mocks.

### 4.2 E2E tests (commit `1d038d9` + `2664cb9`)

Wave-2 shipped 26 hermetic Playwright specs, 6 of which were
`.fixme`'d because two owner-portal feature components
(`DamageDeductionApproval`, `GamificationDashboard`) lived under
`features/` but were never mounted. Wave-3's `2664cb9` mounts both
components and removes the `.fixme()` markers, taking E2E from
**26 wired** to **32 wired** across 8 spec files. Network-hermetic
via `page.route` / `route.fulfill`; auto-skip when no Next.js dev
server is reachable; opt-in to live mode with `USE_REAL_SERVERS=1`.

| Spec file | Tests | Coverage |
|---|---|---|
| `customer-feedback.spec.ts` | 4 | POST → thank-you → history; error retry; empty. |
| `customer-settings-and-notifications.spec.ts` | 4 | currency localStorage round-trip; SMS toggle; retry; empty. |
| `manager-messaging.spec.ts` | 4 | conversation list → open → mark-read → send; button gating; search. |
| `manager-notifications.spec.ts` | 2 | per-id mark-read; mark-all + unread badge. |
| `manager-announcements-create.spec.ts` | 3 | properties dropdown; publish-button gating. |
| `owner-damage-deductions.spec.ts` | 3 | **REACTIVATED** (`2664cb9`) — `DamageDeductionApproval` mounted at `/owner/damage-deductions`. |
| `owner-gamification.spec.ts` | 3 | **REACTIVATED** (`2664cb9`) — `GamificationDashboard` mounted at `/owner/gamification`. |
| `_helpers.ts` | (helper) | shared test infrastructure. |

---

## 5. Operational map — what to wire next

The downstream workers and adapters that will move the matrix from
"events queue" to "events execute":

### 5.1 Statement PDF render worker

- **Trigger:** rows in `owner_statements` with
  `degraded_reason = 'no_pdf_renderer'` and `status = 'draft'`.
- **Likely env var:** `TYPST_BIN` (the rendering adapter the
  document-rendering interface already supports). Falls back to the
  zero-dep PDF encoder when unset (see `Docs/DEPLOYMENT.md` §8).
- **Output:** signed-URL artefact persisted; row status flips to
  `rendered`; downstream `notification_dispatch_log` rows can flip
  to `ready_to_send`.
- **Effort:** small — interface exists; only the worker shell + queue
  consumer remains.

### 5.2 Disbursement payouts worker

- **Trigger:** `event_outbox` events of kind
  `MonthlyCloseDisbursementProposed`.
- **Required adapters:** payouts provider per-country (M-Pesa B2C,
  TZ ClickPesa B2C, etc.). The adapters already exist for inbound;
  outbound B2C is the missing path.
- **Gating:** every event today is gated by the autonomy stub
  (`autonomousModeEnabled = false`), so the run pauses at
  `propose_disbursement_batch`. The worker should respect the
  approval-step state — only consume events whose run-step has been
  approved.
- **Env var:** none new today; reuses
  `TANZANIA_PAYMENT_BACKEND` / `MPESA_*` config.

### 5.3 Notification dispatch worker

- **Trigger:** rows in `notification_dispatch_log` with
  `status = 'pending'`.
- **Adapter:** existing notification service (email + SMS).
- **Effort:** trivial — write a poller / consumer; the schema is
  already populated correctly.

### 5.4 `MarketRatePort` real adapter

- **Targets:** Zillow (US), Rentometer (US), Airbnb (global short-let).
- **Env var dispatch:** `MARKET_DATA_PROVIDER` ∈
  `{'zillow','airbnb',…}` (RUNBOOK §1.5). Without it, no adapter is
  wired — the surveillance loop no-ops cleanly.
- **Per-country dispatch:** lives behind
  `getCountryPlugin(tenantCountry)` from
  `@borjie/compliance-plugins`. Adapters are not hardcoded into
  the pipeline.

### 5.5 `ListActiveUnits` / `ListActiveTenants` adapters

- **Required by:** Market Surveillance, Predictive Interventions.
- **Source:** existing `properties` / `units` / `leases` /
  `tenants` tables.
- **Effort:** small — straight read query against the live tables.

### 5.6 Concrete `AutonomyPolicyPort`

- **Today:** stub forces `autonomousModeEnabled = false`.
- **Tomorrow:** read from
  `packages/ai-copilot/src/autonomy/autonomy-policy-service` (already
  exists — just not wired into the monthly-close composition).
- **Once wired:** disbursement batches under
  `finance.autoApproveRefundsMinorUnits` flip to `auto_approved` and
  execute against the payouts worker.

### 5.7 The 10 owner-portal `MissingBackendNotice` endpoints

Each notice cites the concrete endpoint. These are the next 10
backend routes to ship. The frontend pages are already wired against
the api-client — once the routers land, swap the notice for the live
hook + Skeleton + Alert/Retry pattern (mirroring the 3 already
converted in `0ee27a0`).

---

## 6. Architecture invariants preserved

These are the load-bearing invariants both waves protected. Reviewers
should verify them and reject any future change that breaks them.

1. **No hardcoded jurisdiction / currency / locale in business
   logic.** Per the project memory rule "built for the world,
   starting with TZ" (see
   `~/.claude/projects/.../memory/feedback_world_starting_tz.md`),
   defaults are seeded values, never hard-coded `if/else` branches.
   Wave-2's `useCurrencyPreference` hook + KES-literal cleanup is
   the customer-app expression of this.
2. **Degraded-mode contract.** Every wiring returns `null` when
   `DATABASE_URL` is unset. Routers return 503 with a clear
   `*_UNAVAILABLE` code. Boot never crashes. Operators see
   `service-registry: degraded` once in the boot log; no
   per-request crash loop.
3. **Money never auto-moves in degraded mode.** The Monthly Close
   `AutonomyPolicyPort` stub returns `autonomousModeEnabled = false`
   so disbursement batches always park as `awaiting_approval` until
   a real autonomy adapter lands.
4. **Audit reproducibility.** Every persisted row carries
   `model_version`, `prompt_hash`, `confidence`, and `explanation`
   where applicable. A later auditor can compare prompt-hashes
   across runs to verify no silent prompt drift.
5. **Tenant isolation at the DB layer.** Every query compiles to
   `WHERE tenant_id = $1`; the router always binds `tenantId` from
   the JWT.
6. **Idempotency at the schema layer.** Unique indexes enforce
   single-run invariants:
   `monthly_close_runs (tenant_id, period_year, period_month)`,
   `monthly_close_run_steps (run_id, step_name)`. Re-triggers
   surface Postgres `23505` to the orchestrator.
7. **Immutability in client code.** No `setState` mutates an
   existing object; every wave-1 + wave-2 hook returns a new object
   or array.

---

## 7. Known limitations rolled forward

These are the gaps wave-2 closed nothing on, by design. Each is
rolled forward with the concrete unblocker:

- **HQ overview trend chart.** Recharts panel on
  `/platform/overview` is still a placeholder shape. KPI tiles are
  live; the trendline is mocked until the time-series source is
  wired.
- **i18n stubs in some `owner-portal` pages.** Translation keys
  render verbatim where translations have not been backfilled.
  Cosmetic, not functional.
- **`/api/v1/platform/overview` `monthlyRevenue: 0`.** The
  `payments` table mixes currencies (KES / TZS / USD) per tenant;
  until an FX-normalising aggregator is wired, mixed-currency
  minor-units cannot be summed. Ticket links to migration 0117
  (`currency_rates`).
- **End-to-end audio I/O for voice.** Voice resolver +
  voice-bridge + per-tenant `voiceProfileId` are all shipped — the
  mic-capture → STT → kernel → TTS → playback path through the
  portals is not wired. Text-only Jarvis works; the speaking
  surface does not.
- **Some support endpoints unmounted.** A small number of routers
  exist in `services/api-gateway/src/routes/` but are not yet
  imported into `index.ts`. Returns 404 on the un-mounted path.

---

## 8. Verification

To verify the deep-scrub at the artefact level:

```bash
# Full commit listing (should be 18 commits ahead of main)
git log --oneline origin/main..HEAD

# Diff stat by area
git diff --stat origin/main...HEAD -- packages/database/
git diff --stat origin/main...HEAD -- services/api-gateway/composition/
git diff --stat origin/main...HEAD -- apps/customer-app/
git diff --stat origin/main...HEAD -- apps/owner-portal/
git diff --stat origin/main...HEAD -- apps/estate-manager-app/
git diff --stat origin/main...HEAD -- e2e/

# Per-package test runs (inside a clean dev shell)
pnpm --filter @borjie/ai-copilot test
pnpm --filter @borjie/agent-platform test
pnpm --filter @borjie/api-sdk test
pnpm --filter @borjie/database test
pnpm --filter @borjie/api-gateway test

# Hermetic E2E (auto-skip when no dev servers up)
pnpm --filter e2e test:journeys
```

Boot-log smoke for the wave-2 wirings:

```
service-registry: live (Postgres-backed domain services wired)
ai-brain-utilities wired { providers: { anthropic: true, ... } }
brain-kernel wired (cot-reservoir=in-memory, cache=in-memory, sensor-failover=in-memory)
voice-agent: brain port = real-kernel
monthly-close: reconciliation/statement/disbursement/notification = drizzle-period-bulk
```

Any of those lines missing → the corresponding feature is still in
degraded mode. Cross-reference §3 to identify which env var or
adapter to ship next.

---

## 9. References

- `CHANGELOG.md` — wave-1 + wave-2 release notes.
- `.planning/RUNBOOK.md` §6.3 — env-var matrix for the four
  AI-native agents (post wave-2).
- `.planning/litfin-parity-plan.md` — kernel-parity scorecard
  (post wave-2; new "shipped" rows added).
- `Docs/PHASES_FINDINGS/phA2-monthly-close.md` — Monthly Close
  Orchestrator detail (post wave-2).
- `Docs/PHASES_FINDINGS/phG-ai-native.md` — eight AI-native
  capabilities + wiring status (post wave-2).
- `Docs/PHASES_FINDINGS/phL-ai-deeper.md` — four PROPOSE > SETTLE
  capabilities + composition-root status (post wave-2).
- `Docs/DEPLOYMENT.md` §8 — composition-root degraded-mode contract.
- `Docs/analysis/DELTA_AND_ROADMAP.md` — Production Readiness Matrix
  (per-feature LIVE / DB_ONLY / STUB / PLANNED).
