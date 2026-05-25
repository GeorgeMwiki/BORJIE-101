# SCAFFOLDED → BUILT Completion Specs

**Project:** BORJIE Property Management SaaS
**Date:** 2026-04-18
**Non-negotiable rule:** amplify existing code. Every spec preserves current scaffolding and extends it. No deletion of core logic without a like-for-like replacement already in place.

## Ordering & Complexity

| # | Feature | Complexity | Blocks |
|---|---|---|---|
| 1 | Migration Wizard commit path | M | tenant onboarding at scale |
| 2 | Asset infinite subdivision | S | unit hierarchy UI |
| 3 | Case state machine & SLA | M | dispute UX, compliance |
| 4 | Lease renewal workflow | M | renewal scheduler |
| 5 | Tenant financial statement intake | S | credit scoring |
| 6 | Credit/risk scoring deterministic engine | M | payment-flex approvals |
| 7 | AI persona Migration Wizard wiring | S | depends on #1 |
| 8 | Notifications domain-event wiring | S-M | case, renewal alerts |
| 9 | Vendor matcher on Anthropic + DB-backed | M | maintenance auto-dispatch |
| 10 | API gateway hardening | M | cross-cutting |
| 11 | Design system Storybook + publish | S | app consistency |
| 12 | Approval policy per-org configurability | S | admin UX |
| 13 | OCR provider concrete implementations | M | identity verification |
| 14 | Churn predictor deterministic baseline | M | retention Coworker NBA |

S = <1 day, M = 1–3 days, L = >3 days.

---

## 1. Migration Wizard — CSV/Excel/PDF Ingest

**Scaffolded code:** `packages/ai-copilot/src/skills/domain/migration.ts:1-530`. `migrationExtract` lines 161-306, `migrationDiff` 370-435, `migrationCommitTool` 485-523 (explicit dry-run at 509-515). Persona `MIGRATION_WIZARD_TEMPLATE` in `packages/ai-copilot/src/personas/personas.catalog.ts`.

**What's missing:**
- `migrationCommitTool.execute` (line 497) returns hardcoded `note: 'Phase 1 commit is a dry-run'`. No writes occur.
- No XLSX/CSV buffer parser; `sheets` input synthesized externally.
- No PDF/image OCR fallback beyond plain-text regex at 292-303.
- No `MigrationRun` persistence row — no resume/audit/rollback.
- No diff-review UI in `apps/estate-manager-app` or `apps/admin-portal`.
- `migrationDiff` only emits ADDs; UPDATE and SKIP-with-reason absent.
- No tenant-scoped idempotency key — re-uploading double-inserts.

**Completion plan:**
1. Parser adapters under `packages/ai-copilot/src/services/migration/parsers/`: `csv-parser.ts`, `xlsx-parser.ts` (exceljs), `pdf-text-parser.ts` (shells into OCR from spec 13). Export `parseUpload(buffer, mimeType)` returning the `sheets` shape expected at `migration.ts:103-110`.
2. Repository: `services/domain-services/src/migration/migration-repository.interface.ts` + `postgres-migration-repository.ts` with `runInTransaction(tenantId, bundle)` using Drizzle, one PG transaction, `ON CONFLICT DO NOTHING` on natural keys `(tenant_id, property_name)`, `(tenant_id, property_id, unit_code)`.
3. `migration_runs` table written at each transition.
4. Rewrite `migration.ts:497-522`: lookup `MigrationRun` by `runId`, assert `approved`, call repo, mark `committed`, emit `MigrationCommittedEvent`. On failure, `failed` with error, keep bundle for retry.
5. Expand `migrationDiff` (370-435): add UPDATE bucket (compare incoming to existing snapshots); per-row `skipReason`.
6. UI at `apps/estate-manager-app/src/features/migration/`: upload → preview → approve → commit.
7. Emit `MigrationRollbackRequested` + `rollback_at` column for future story.

**Data model:**
```sql
migration_runs (
  id text pk, tenant_id text fk, uploaded_by text fk users(id),
  filename text, file_hash text, bundle jsonb, diff jsonb,
  status text,                     -- extracted|diffed|approved|committed|failed
  counts jsonb, error text, rollback_at timestamptz,
  created_at timestamptz default now(),
  unique(tenant_id, file_hash)     -- idempotency
);
```

**Tests:**
- Unit: parser roundtrip per mime; `migrationExtract` per sheet kind; diff UPDATE path for changed `rentKes`; idempotency-by-hash.
- Integration: upload → diff → approve → commit against Postgres testcontainer; re-upload refuses double-commit; row-50-of-100 FK failure rolls back all 100.
- E2E: Playwright fixture upload, verify DB row counts.

**Complexity:** M (2–3 days).
**Depends on:** spec 13 (PDF route). CSV/XLSX ships first.

---

## 2. Asset Registry & Infinite Subdivision

**Scaffolded code:** units table at `packages/database/src/schemas/property.schema.ts:143-216` — has `id`, `tenantId`, `propertyId`, `blockId`, `unitCode`, `type`, `status`, `floor`, `building`, `wing`. **No `parentUnitId` column** (grep confirms — gap doc at line 149 is inaccurate). Asset domain model at `packages/domain-models/src/operations/asset.ts:1-560` with `createAsset` (284), `retireAsset`, `disposeAsset`, `calculateDepreciation`, `addMaintenanceRecord`.

**What's missing:**
- No `parentUnitId` FK, no depth, no materialized path.
- No business rule depth cap.
- No service `subdivideUnit(parentUnitId, children[])` preserving parent lease pointer + reallocating rent.
- No UI.

**Completion plan:**
1. Schema migration on units: `parent_unit_id text references units(id) on delete restrict`, `depth integer not null default 0`, `path text not null`, indexes `units_parent_idx`, `units_path_idx on (path text_pattern_ops)`.
2. New service `services/domain-services/src/units/unit-subdivision-service.ts`:
   - `subdivideUnit(parentId, children, actor)` — refuse if parent has active lease or status not in `('vacant','under_construction')`. Children get `depth = parent.depth + 1`, `path = parent.path + '/' + newId`. Emit `UnitSubdividedEvent`. Hard cap `MAX_DEPTH = 5`, throw `MAX_SUBDIVISION_DEPTH_REACHED`.
   - `mergeUnits(childIds[], into, actor)` — inverse; all children must be vacant.
   - `listDescendants(unitId)` via `path LIKE parent.path || '/%'`.
3. Extend `packages/domain-models/src/operations/asset.ts` (don't delete existing `Asset` at line 213) with `assetHierarchy(asset, children)` helper.
4. Graph sync: extend `packages/graph-sync/src/sync/graph-sync-engine.ts` to MERGE `(:Unit)-[:CONTAINS]->(:Unit)` on `parent_unit_id` change, keeping `(:Property)-[:HAS_UNIT]->(:Unit)` intact.
5. Tree view UI at `apps/estate-manager-app/src/features/units/UnitTree.tsx` with Subdivide/Merge context menu.

**Tests:**
- Unit: subdivide happy path; refuse at depth 5; refuse with active lease; path propagation.
- Integration: 4-level tree, descendant query, merge middle, confirm lease pointers.
- RLS: cross-tenant subdivision rejected.

**Complexity:** S (1 day).

---

## 3. Case / Dispute Resolution State Machine

**Scaffolded code:** `services/domain-services/src/cases/index.ts:1-490`. Status enum at 32: `OPEN|IN_PROGRESS|PENDING_RESPONSE|ESCALATED|RESOLVED|CLOSED`. `CaseService` with `createCase` (285), `updateCase` (340 — spreads arbitrary input), `escalateCase` (411), `resolveCase` (432), `closeCase` (456). `// @ts-nocheck` at line 1.

**What's missing:**
- No guard on status transitions. `updateCase:346` does `{ ...caseEntity, ...input }`; de-escalation undefined.
- No SLA engine — `dueDate` stored but no background job breaches it.
- No auto-escalation on SLA breach.
- Events published (lines 232-274) but gateway subscribers don't cover all.
- No resolution letter templates.

**Completion plan:**
1. `services/domain-services/src/cases/state-machine.ts`:
   ```ts
   TRANSITIONS = {
     OPEN: ['IN_PROGRESS','PENDING_RESPONSE','ESCALATED','CLOSED'],
     IN_PROGRESS: ['PENDING_RESPONSE','ESCALATED','RESOLVED','CLOSED'],
     PENDING_RESPONSE: ['IN_PROGRESS','ESCALATED','RESOLVED','CLOSED'],
     ESCALATED: ['IN_PROGRESS','RESOLVED','CLOSED'],
     RESOLVED: ['CLOSED'], CLOSED: [],
   }
   ```
2. New `transitionCase(caseId, nextStatus, reason, actor, correlationId)` added to `CaseService` (line 282) — don't remove existing methods. Calls `assertTransition`, appends timeline event, publishes `CaseStatusChangedEvent`.
3. SLA worker `services/domain-services/src/cases/sla-worker.ts` on 5-min CRON (reuse pattern from `services/reports/src/scheduler/scheduler.ts`). Uses existing `caseRepo.findOverdue`. If `escalationLevel < MAX_ESCALATION_LEVEL`, call `escalateCase`; else emit `CaseSLABreachedEvent`.
4. Add subscribers in `services/api-gateway/src/workers/event-subscribers.ts` for `CaseCreated`, `CaseEscalated`, `CaseResolved`, `NoticeSent`, `CaseSLABreached`.
5. New `services/domain-services/src/documents/templates/case-resolution.template.ts`; `resolveCase:432` optionally renders + attaches.
6. Repair `// @ts-nocheck` only after domain-model imports are fixed, not before.

**Data model:** extend `cases.schema.ts`:
- `sla_hours integer` (defaults: LOW 168, MEDIUM 72, HIGH 24, CRITICAL 4)
- `sla_breached_at timestamptz`

**Complexity:** M (2 days).
**Depends on:** spec 8.

---

## 4. Lease Renewal Workflow

**Scaffolded code:** `packages/ai-copilot/src/services/renewal-strategy-generator.ts:1-659` — full AI generator (OpenAI at 466, 472). Lease schema `packages/database/src/schemas/lease.schema.ts:1-227` — **no `renewalDate`, `renewalStatus`, `terminationDate`** (grep confirmed). Skill `RENEWAL_PROPOSE` in `packages/ai-copilot/src/skills/domain/leasing.ts`.

**What's missing:**
- Lease schema has no renewal lifecycle columns.
- No scheduler firing `RenewalWindowOpened` at T-90/60/30.
- Uses OpenAI — should be Anthropic with Opus advisor.
- No end-of-tenancy checklist wiring.
- No renewal accept/reject endpoint or durable state.

**Completion plan:**
1. Schema additions to `lease.schema.ts`:
   - `renewal_status text not null default 'not_started'` (`not_started|proposed|negotiating|accepted|declined|lapsed`)
   - `renewal_window_opened_at timestamptz`
   - `renewal_proposed_at timestamptz`, `renewal_proposed_rent integer`
   - `renewal_decided_at timestamptz`, `renewal_decision_by text fk users(id)`
   - `termination_date timestamptz`, `termination_reason text`
2. `services/domain-services/src/lease/renewal-service.ts`:
   - `openRenewalWindow(leaseId, daysOut)` — idempotent.
   - `proposeRenewal(leaseId, strategyResult)` — persist generator output.
   - `acceptRenewal(leaseId, actor)` — create new lease row `active_from = old.active_to + 1 day`; old lease immutable; occupancy updated.
   - `declineRenewal(leaseId, reason)` — trigger end-of-tenancy flow.
3. `services/reports/src/scheduler/renewal-scheduler.ts` daily CRON: query `leases where active_to between now+29d and now+91d and renewal_status='not_started'`.
4. `services/domain-services/src/lease/move-out-checklist.ts`: final inspection, utility reading, deposit reconciliation, residency-proof letter.
5. Migrate `renewal-strategy-generator.ts` from OpenAI to Anthropic. Keep existing `RenewalStrategyResultSchema` (line 379); only transport changes. **Don't delete class** — remove OpenAI imports only after new path has tests.
6. Wire `RENEWAL_PROPOSE` skill to call `renewalService.proposeRenewal`.

**Events:** `RenewalWindowOpened`, `RenewalProposed`, `RenewalAccepted`, `RenewalDeclined`, `LeaseTerminated`.

**Complexity:** M (2–3 days).

---

## 5. Tenant Financial Statement Intake

**Scaffolded code:** `packages/database/src/schemas/customer.schema.ts:1-161` — basic customer fields. Grep for `financialStatement|litigation` returns no matches.

**What's missing:**
- No `tenant_financial_statements` table.
- No `tenant_litigation_history` table.
- No verification workflow.
- No link into `PaymentRiskService` (spec 6).

**Completion plan:**
1. New `packages/database/src/schemas/tenant-finance.schema.ts`:
   ```sql
   tenant_financial_statements (
     id text pk, tenant_id text fk, customer_id text fk customers(id),
     annual_income_minor integer, income_currency text default 'TZS',
     employment_status text,             -- employed|self_employed|unemployed|retired|student
     employer_name text,
     monthly_debt_obligations_minor integer,
     bank_reference_status text default 'unverified', -- unverified|pending|verified|failed
     bank_name text, verification_doc_ids text[],
     submitted_at timestamptz, verified_at timestamptz, verified_by text fk users(id)
   );
   tenant_litigation_history (
     id text pk, tenant_id text fk, customer_id text fk customers(id),
     case_reference text, case_date date,
     outcome text,                       -- pending|won|lost|settled|dismissed
     amount_minor integer, currency text, jurisdiction text, notes text,
     source text                         -- self_declared|verified|external
   );
   ```
2. `services/domain-services/src/customer/financial-profile-service.ts` with `submitStatement`, `verifyBankReference` (pluggable `IBankReferenceProvider`), `recordLitigation`. Emit `FinancialStatementSubmitted`.
3. Consumed by `PaymentRiskCalculator` (spec 6). Keep `PaymentRiskService` intact.
4. Intake form in `apps/customer-app`; review screen in `apps/estate-manager-app`.

**Complexity:** S (1 day).

---

## 6. Credit/Risk Scoring Algorithm

**Scaffolded code:** `packages/ai-copilot/src/services/payment-risk.ts:1-212`. Class at 146-196 calls `openai.chat.completions.create` (line 162) — 100% LLM. `PaymentRiskResultSchema` at 103. Intelligence fields `riskScore`, `churnScore`, `sentimentScore` in `services/domain-services/src/intelligence.schema.ts` but unpopulated.

**What's missing:**
- No deterministic floor; LLM-only.
- No weight table, no threshold constants.
- No write-back to intelligence.
- OpenAI — should be Anthropic.
- No hookup into approval engine for payment flexibility.

**Completion plan:**
1. New `packages/ai-copilot/src/services/risk/payment-risk-calculator.ts`:
   ```ts
   WEIGHTS = { history: 0.45, income: 0.25, employment: 0.15, arrears: 0.10, litigation: 0.05 }
   score = Σ (weight * sub_score) on 0–100
   // Thresholds: >=75 LOW, 60-74 MODERATE, 40-59 ELEVATED, 25-39 HIGH, <25 CRITICAL
   ```
2. Preserve `PaymentRiskService:146-196` as explanation layer: deterministic score first, then optional Anthropic call for `reasoning`, `earlyWarningSignals`, `interventions`. Compose inside `predictPaymentRisk` (line 159).
3. Swap OpenAI → Anthropic with Opus advisor gate for narration.
4. Add `payment_flexibility` approval type in `services/domain-services/src/approvals/default-policies.ts`: `LOW|MODERATE` auto-approve ≤3mo; `ELEVATED` estate-manager review; `HIGH|CRITICAL` property-manager + guarantor.
5. Write result to `intelligence.risk_score`.

**Data model:** add `risk_score_updated_at`, `risk_score_version` columns to `intelligence`. Extend `approval_type` enum with `payment_flexibility`.

**Complexity:** M (2 days).
**Depends on:** spec 5.

---

## 7. AI Persona: Migration Wizard Copilot Wiring

**Scaffolded code:** `MIGRATION_WIZARD_TEMPLATE` in `packages/ai-copilot/src/personas/personas.catalog.ts`. Orchestrator at `packages/ai-copilot/src/orchestrator/orchestrator.ts`. Tool dispatcher at `packages/ai-copilot/src/orchestrator/tool-dispatcher.ts`.

**What's missing:**
- Verify `MIGRATION_SKILL_TOOLS` (exported at `skills/domain/migration.ts:525-530`) is actually registered with dispatcher.
- Persona prompt doesn't always emit `PROPOSED_ACTION` on diff→commit.
- No typed copilot file analogous to `maintenance-triage.copilot.ts`.

**Completion plan:**
1. Register `MIGRATION_SKILL_TOOLS` in tool-dispatcher if missing.
2. Update persona prompt to emit `PROPOSED_ACTION` for commit transitions.
3. Add `packages/ai-copilot/src/copilots/migration-wizard.copilot.ts` mirroring `maintenance-triage.copilot.ts`.
4. Wire gateway `POST /api/v1/brain/migration/:runId/ask`.

**Complexity:** S (half day after spec 1).
**Depends on:** spec 1 (hard blocker).

---

## 8. Notifications — Domain-Event Wiring

**Scaffolded code:** `services/notifications/src/index.ts:1-216` re-exports six providers (Meta/Twilio WhatsApp, Africa's Talking/Twilio SMS, SendGrid/SES/SMTP email, Firebase push). Registry at `services/notifications/src/providers/index.ts:1-31`. `services/api-gateway/src/workers/event-subscribers.ts` exists with `registerDomainEventSubscribers` (wired from api-gateway `index.ts:291`). HTTP dispatcher at `services/api-gateway/src/index.ts:263-290`.

**What's missing (narrower than gap doc implies — providers are wired):**
- Event-coverage audit: need subscribers + templates for `CaseCreated`, `CaseEscalated`, `CaseResolved`, `NoticeSent`, `RenewalWindowOpened`, `RenewalProposed`, `PaymentOverdue`, `WorkOrderAssigned`, `InspectionScheduled`.
- `preferences/service.ts` not queried before send (opt-out not enforced).
- No retry/DLQ beyond default.
- Delivery receipts: Africa's Talking `DeliveryReport` type exists but no handler persists it.

**Completion plan:**
1. Fill subscribers in `event-subscribers.ts`. Each: load recipient + channel pref from `preferencesService`, resolve template, enqueue via `enqueueNotification`.
2. Queue consumer re-checks preference before provider call (defence-in-depth).
3. Webhook routes `POST /api/v1/notifications/webhooks/{africastalking,twilio,meta}` → update `messaging.delivery_status`.
4. Worker increments `attempt_count`; at 3 failures → `notifications_dlq` + `NotificationDeliveryFailed`.
5. Mock-provider integration test: fire `CaseCreated`, assert SMS attempted on preferred channel.

**Data model:** extend `messaging.schema.ts`: `attempt_count integer default 0`, `delivery_status text`, `delivery_reported_at timestamptz`, `provider_message_id text`.

**Complexity:** S–M (1–2 days).

---

## 9. Vendor Matching — Anthropic + DB-backed

**Scaffolded code:** `packages/ai-copilot/src/services/vendor-matcher.ts:1-208`. OpenAI at 6, `matchVendor:148` calls `openai.chat.completions.create:151`. `getMockVendors:168` returns two hardcoded vendors. Real vendors table in `packages/database/src/schemas/maintenance.schema.ts`. Graph tool `GET_VENDOR_SCORECARD` exists.

**What's missing:**
- No DB-backed vendor lookup (mocks only).
- OpenAI not Anthropic.
- No explicit scoring math pre-LLM.
- Ratings not aggregated from history.

**Completion plan:**
1. `services/domain-services/src/vendors/vendor-repository.interface.ts` + `postgres-vendor-repository.ts` with `findAvailable(specialty, area, tenantId)`.
2. `packages/ai-copilot/src/services/risk/vendor-score-calculator.ts`:
   ```ts
   skillMatch = specialty ∈ vendor.specialties ? 1 : 0
   responsiveness = 1 - min(1, avgResponseTimeHours/24)
   quality = 1 - repeatCallRate/100
   onTime = onTimeCompletion/100
   cost = budget.max ? clamp(1 - (quoteMid - budgetMid)/budgetMid, 0, 1) : 0.5
   overall = 0.30*skill + 0.20*responsiveness + 0.25*quality + 0.15*onTime + 0.10*cost
   ```
3. Replace OpenAI at `vendor-matcher.ts:151-166` with Anthropic. Keep `VendorMatchingResultSchema:109` intact; LLM narrates over pre-scored vendors.
4. Nightly worker recomputes vendor `ratings.*` from 180-day completed-work-order window.
5. Don't delete `getMockVendors` — relocate to `__fixtures__/vendor-fixtures.ts`, retain factory that prefers DB and falls back only in dev.

**Data model:** add `rating_last_computed_at`, `rating_sample_size` columns to vendors.

**Complexity:** M (2 days).

---

## 10. API Gateway Hardening

**Scaffolded code:** `services/api-gateway/src/index.ts:1-304` — richer than gap doc claims. Express + Hono, helmet, cors whitelist (71-108), pinoHttp (110), rate-limit (111), outbox worker (243-251), event subscribers (258-294), 30+ route modules, graceful shutdown. Middleware: `auth.middleware.ts`, `authorization.ts`, `hono-auth.ts`, `rbac.middleware.ts`, `tenant-context.middleware.ts`, `token-blocklist.ts`, `audit.middleware.ts`, `error-handler.ts`, `rate-limiter.ts`.

**What's missing (consistency + observability):**
- Dual auth middleware (Express + Hono) — drift risk.
- No OpenAPI emission.
- No shared error envelope — global handler at 196-209 generic.
- Request-ID propagation to downstream fetch (272-290) unverified.
- `Idempotency-Key` in CORS (line 104) but no middleware enforces it.
- No circuit breaker on fetch to `NOTIFICATIONS_SERVICE_URL`.

**Completion plan:**
1. Shared `verifyJwt(token)` in `middleware/auth-core.ts`; both Express and Hono wrap it; parity test.
2. Uniform error envelope `{ error: { code, message, requestId, details? } }` via Hono `onError` + Express error middleware.
3. `@hono/zod-openapi` to emit `/api/v1/openapi.json`.
4. Idempotency middleware for POST/PUT/PATCH: `(tenantId, key) → response_hash` in Redis 24h, replay on duplicate.
5. `X-Request-Id` set by `pinoHttp`, forwarded on outbound fetch.
6. Wrap outbound fetch with `opossum` circuit breaker.

**Complexity:** M (2–3 days).

---

## 11. Design System — Storybook + Publish

**Scaffolded code:** `packages/design-system/src/index.ts:1-242` exports 25+ components: Button, Input, Select, Modal, Table, Card, Badge, Alert, Tabs, Sidebar, DataGrid, Label, Dialog, Dropdown, DropdownMenu, Toast, Tooltip, Separator, Avatar, Skeleton, Spinner, ErrorBoundary, Pagination, Progress, Empty, Header, Stat, FormField, DataTable, StatCard, EmptyState.

**What's missing (governance, not components):**
- No Storybook.
- No README / prop tables.
- No visual regression tests.
- No internal npm publishing pipeline.
- No versioning/changelog.

**Completion plan:**
1. `packages/design-system/.storybook/main.ts` (vite builder), one story per component.
2. `react-docgen-typescript` → Storybook autodocs for prop tables.
3. `@storybook/test-runner` + Playwright snapshots (or Chromatic).
4. Changesets + release workflow to private registry.
5. `lib/tokens.ts` exporting Tailwind design tokens so apps consume one source.

**Complexity:** S (1 day; +1 with visual regression).

---

## 12. Approval Policy — Per-Org Configurability

**Scaffolded code:** `services/domain-services/src/approvals/default-policies.ts:1-80+`. Thresholds literal at 42-56, 68-87. `approval-service.ts` consumes via repo interface.

**What's missing:**
- Thresholds hardcoded.
- No `approval_policies` persistence.
- No admin UI.
- No seeding of defaults on tenant create.

**Completion plan:**
1. New `packages/database/src/schemas/approval-policy.schema.ts`:
   ```sql
   approval_policies (
     tenant_id text, type text,
     policy_json jsonb not null,
     updated_at timestamptz, updated_by text fk users(id),
     primary key(tenant_id, type)
   );
   ```
2. `PostgresApprovalPolicyRepository` implementing existing interface. When row absent, fall back to `getDefaultPolicyForType:10-29`. **Preserve defaults as floor — don't delete them.**
3. `apps/admin-portal/src/features/policies/` CRUD validated against zod `ApprovalPolicy`.
4. Tenant bootstrap copies defaults into `approval_policies`.

**Complexity:** S (1 day).

---

## 13. OCR Providers — Concrete Implementations

**Scaffolded code:** `services/document-intelligence/src/services/ocr-extraction.service.ts:1-60+`, `IOCRProvider` interface at 39. Grep for `implements IOCRProvider` returns only this one file — **no concrete providers exist**.

**What's missing:**
- No `aws-textract.provider.ts`.
- No `google-vision.provider.ts`.
- No provider-factory routing by mimeType/documentType.
- No fixture test corpus.
- No chat-with-document (Module G.3).

**Completion plan:**
1. `services/document-intelligence/src/providers/aws-textract.provider.ts` implementing `IOCRProvider`; `@aws-sdk/client-textract`. For pdf/png/jpeg → `AnalyzeDocument` with `FORMS,TABLES`. Map blocks to `ExtractedField[]`.
2. `providers/google-vision.provider.ts` using `@google-cloud/vision`. Same interface.
3. `providers/ocr-factory.ts` routes by config.
4. Fixture corpus at `services/document-intelligence/__fixtures__/ids/`: Tanzania NIDA, Kenya ID, driving licence, utility bill, bank statement. Each with expected `ExtractedField[]`.
5. `services/document-intelligence/src/services/document-chat.service.ts` — Anthropic over `rawText + structuredData`, Opus gate for sensitive docs.

**Complexity:** M (2 days).

---

## 14. Churn Predictor — Deterministic Baseline + ML Hook

**Scaffolded code:** `packages/ai-copilot/src/services/churn-predictor.ts:1-80+`. Types fully defined. Imports OpenAI (line 6) — LLM-only. Complementary services exist: `friction-fingerprint-analyzer.ts`, `sentiment-analyzer.ts`, `nba-manager-queue.ts`, `next-best-action.ts`.

**What's missing:**
- No deterministic baseline.
- No retraining pipeline or feature store.
- NBA queue not wired to churn score.
- No day-over-day trend.

**Completion plan:**
1. `packages/ai-copilot/src/services/risk/churn-baseline-calculator.ts`:
   ```ts
   // Inputs: latenessRate, complaints90d, openMaintCount,
   //         daysSinceLastPositiveInteraction, marketRentDelta
   // Weights: lateness 0.30, complaints 0.25, maint 0.15, recency 0.15, market 0.15
   ```
2. Compose: deterministic first, LLM narrates `drivers` + `retentionRecommendations`. Keep `ChurnPredictor` class intact.
3. Interface `IChurnModel { score(features): Promise<number|null> }`; stub returns null so baseline wins. Later ONNX or Python service.
4. Daily snapshots to `intelligence_history`; Coworker persona quotes trend deltas.
5. Score crossing `HIGH|VERY_HIGH` → enqueue Coworker task in `nba-manager-queue.ts`.
6. Don't remove existing LLM path — it becomes narration layer.

**Data model:**
```sql
intelligence_history (
  id text pk, tenant_id text fk, customer_id text fk customers(id),
  snapshot_date date,
  risk_score int, churn_score int, sentiment_score int,
  feature_vector jsonb,
  unique(tenant_id, customer_id, snapshot_date)
);
```

**Complexity:** M (2–3 days).
**Depends on:** spec 8.

---

## Cross-cutting observations

- **Every scaffolded AI service uses OpenAI.** Specs 4, 6, 9, 14 each carry an Anthropic migration. Factor into shared `packages/ai-copilot/src/providers/anthropic-client.ts`.
- **Notifications subscribers unlock most other work.** Specs 3, 4, 6, 14 all require events-to-users. Land spec 8 first.
- **Deterministic floor before LLM.** Specs 6, 9, 14 all adopt: compute with rules, use model only for narration.
- **No schema breakage anywhere.** All new columns nullable or defaulted. No backfill required.
