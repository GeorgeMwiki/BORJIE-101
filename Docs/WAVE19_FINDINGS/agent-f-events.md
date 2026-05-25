# Wave 19 — Agent F: Event Flow Audit

## Scope

Audit the event-driven infrastructure end-to-end:

- `services/api-gateway/src/workers/{outbox-worker,webhook-retry-worker,event-subscribers}.ts`
- `packages/observability/src/event-bus.ts` (the platform `EventBus`)
- `services/domain-services/src/common/events.ts` (the in-memory domain `EventBus`)
- every domain service that calls `eventBus.publish(...)` across
  `services/domain-services/src/*`, `services/payments-ledger/src/*`,
  `services/reports/src/*`, `services/notifications/src/*`,
  `services/api-gateway/src/routes/*`, and `packages/ai-copilot/src/*`

Two separate event-bus implementations live in the monorepo:

1. **Domain bus** — `InMemoryEventBus` from `@borjie/domain-services`.
   Exact-match `subscribe(eventType, handler)`; publishes `EventEnvelope`
   shapes like `{event: {eventType, tenantId, payload, …}, aggregateId,
   aggregateType, version}`. This is the bus every domain service
   constructor receives.
2. **Observability bus** — `EventBus` from `@borjie/observability`.
   Pattern-match `subscribe(pattern, handler)` with outbox support;
   publishes `DomainEvent<T>` shapes with a `type` field. This is the
   bus the `outbox-worker` drains and the 124 api-gateway subscribers
   attach to.

## Root cause (bus-level gap)

`services/api-gateway/src/composition/service-registry.ts:411` instantiates
the domain bus:

    const eventBus: EventBus = input.eventBus ?? new InMemoryEventBus();

`services/api-gateway/src/index.ts:849` instantiates a **different** bus:

    runner = obs.getEventBus?.({ serviceName: 'api-gateway', enableOutbox: true });

`registerDomainEventSubscribers({ bus: subscribableBus = runner })`
wires all 124 subscribers onto the observability bus. No publisher
reaches it — every `InvoiceOverdue`, `PaymentReceived`,
`LeaseTerminated`, `CaseSLABreached`, etc. was silently dropped on the
floor in production. The test suite passed because
`event-subscribers.test.ts` uses an in-process `FakeBus` where publish
and subscribe trivially line up.

**Fix landed** (see "Ghost publishers fixed"): the domain bus now
exposes `addForwarder()` and the composition root installs a bridge
that replays every domain envelope onto the observability bus with
both `type` and `eventType` populated. The outbox drainer does the
rest.

## Event registry

Compact table of every published event → every registered subscriber.
All 124 subscribers use `event.eventType ?? event.type`, so the bridge
translates envelope → flat event with both fields set.

| Event type (eventType) | Publisher file(s) | api-gateway subscriber(s) |
|---|---|---|
| PAYMENT_SUCCEEDED | payments-ledger/payment-orchestration | notifications (SMS receipt), audit, observability |
| PAYMENT_FAILED | payments-ledger/payment-orchestration | notifications (failure SMS) |
| PAYMENT_REFUNDED | payments-ledger/payment-orchestration | notifications |
| PAYMENT_INTENT_CREATED | payments-ledger/payment-orchestration | observability only |
| PAYMENT_PROCESSING_STARTED | payments-ledger/payment-orchestration | observability only |
| PaymentReceived | domain-services/payment | notifications |
| PaymentOverdue | payments-ledger (TBC) / reports | arrears-notice notifications |
| STATEMENT_GENERATED | payments-ledger/statement-generation | email to owner/customer |
| STATEMENT_SENT | payments-ledger/statement-generation | audit only |
| DISBURSEMENT_INITIATED | payments-ledger/disbursement | observability only |
| DISBURSEMENT_COMPLETED | payments-ledger/disbursement | notifications (owner) |
| DISBURSEMENT_FAILED | payments-ledger/disbursement | observability + alert |
| LEDGER_ENTRIES_CREATED | payments-ledger/ledger | observability only |
| ACCOUNT_BALANCE_UPDATED | payments-ledger/ledger | observability only |
| RECONCILIATION_COMPLETED | payments-ledger/reconciliation | observability only |
| RECONCILIATION_EXCEPTION | payments-ledger/reconciliation | audit + alert |
| InvoiceCreated / InvoiceGenerated / InvoiceSent / InvoicePaid / InvoiceOverdue | domain-services/invoice + domain-services/payment | notifications + (InvoiceOverdue → arrears auto-open) |
| LeaseCreated / LeaseActivated / LeaseTerminated / DepositReturned / LeaseRenewalWindow / LeaseTerminatedByRenewal | domain-services/lease | notifications |
| RenewalWindowOpened / RenewalProposed / RenewalAccepted / RenewalDeclined / RenewalReminder | services/reports/renewal-scheduler + domain-services/lease/renewal-service | notifications |
| WorkOrderCreated / WorkOrderAssigned / WorkOrderCompleted / SLABreached | domain-services/maintenance | notifications |
| CaseCreated / CaseEscalated / CaseResolved / CaseSLABreached / CaseStatusChanged / CaseEvidenceAdded | domain-services/cases | notifications |
| NoticeSent / NoticeServed | domain-services/cases + domain-services/compliance | notifications |
| LegalCaseCreated / LegalCaseClosed / LegalCaseStatusChanged | domain-services/compliance | notifications |
| ComplianceDue / ComplianceOverdue | domain-services/compliance | notifications |
| CustomerCreated / CustomerKYCVerified | domain-services/customer + domain-services/lease | notifications |
| FinancialStatementSubmitted / BankReferenceVerified / LitigationRecorded | domain-services/customer/financial-profile-service | audit + observability |
| UserCreated / UserInvited / UserActivated / UserSuspended / UserLocked / UserRoleAssigned / UserRoleRemoved | domain-services/identity | notifications + audit |
| SessionCreated / SessionRevoked / RoleCreated | domain-services/identity | audit + observability |
| TenantCreated / TenantSuspended / TenantActivated / TenantUpdated / OrganizationCreated | domain-services/tenant | audit + observability |
| PropertyCreated / UnitCreated / BlockCreated / BulkUnitsCreated | domain-services/property | observability |
| VendorCreated / VendorStatusChanged / VendorScorecardUpdated | domain-services/vendor | observability |
| FeedbackReceived / ComplaintEscalated / ServiceRecoveryCaseCreated / ServiceRecoveryCaseResolved | domain-services/feedback | notifications |
| InspectionScheduled / InspectionCompleted / InspectionSigned / DamageIdentified | domain-services/inspections | notifications |
| ConditionalSurveyScheduled / ConditionalSurveyCompiled / FarConditionCheckLogged / MoveOutSelfCheckoutCompleted | domain-services/inspections | notifications |
| NegotiationOpened / NegotiationCounter / NegotiationEscalated / NegotiationAccepted / NegotiationRejected | domain-services/negotiation | notifications |
| TenderPublished / BidSubmitted / TenderAwarded / TenderCancelled | domain-services/marketplace/tender | notifications |
| MarketplaceEnquiryStarted | domain-services/marketplace/enquiry | notifications |
| MeterReadingRecorded / UtilityBillCreated / HighConsumptionAlert | domain-services/utilities | notifications + alert |
| ApprovalRequested / ApprovalGranted / ApprovalRejected / ApprovalEscalated | domain-services/approvals | notifications |
| DocumentUploaded / DocumentDeleted / DocumentAccessGranted / DocumentOCRCompleted / DocumentFraudFlagged / EvidencePackCompiled | domain-services/document + domain-services/documents | audit + notifications |
| MessageSent / ConversationCreated | domain-services/messaging | observability |
| OnboardingStarted / OnboardingStepCompleted / OnboardingCompleted / MoveInInspectionSubmitted / ProcedureTrainingCompleted | domain-services/onboarding | notifications |
| EventScheduled / EventCancelled / EventReminderSent | domain-services/scheduling | notifications |
| WaitlistJoined / WaitlistOptedOut / WaitlistVacancyWaveDispatched | domain-services/waitlist | notifications |
| ReportGenerated | domain-services/report | observability |
| ScanBundleCreated / ScanBundleOcrRequested / ScanBundleSubmitted | api-gateway/scans.router | **no subscriber** (see ghost publishers) |
| DocChatSessionStarted / DocChatQuestionAnswered / DocChatMessagePosted | api-gateway/doc-chat.router | **no subscriber** |
| ComplianceExportRequested | api-gateway/compliance.router | **no subscriber** |
| DocumentRenderRequested | api-gateway/document-render.router | **no subscriber** |
| ActionPlanAcknowledged | api-gateway/interactive-reports.router | **no subscriber** |
| NotificationDeliveryStatus / WebhookDeliveryQueued | api-gateway/index.ts | **no subscriber** (WebhookDeliveryQueued is consumed by external webhook-retry worker path, not via bus) |
| NotificationDeliveryFailed | notifications/dispatcher | **no subscriber** |
| GdprDeletionRequested / GdprDeletionExecuted | domain-services/compliance/gdpr-service | **no subscriber** |
| MessageRead / ConversationClosed | domain-services/messaging | **no subscriber** |
| training.assigned / training.force_completed | ai-copilot/training-assignment-service | **no subscriber** |

## Ghost publishers fixed

**Finding #1 (critical):** The entire event-bus wiring was non-functional.
Domain-services `InMemoryEventBus` publishes were never observed by the
124 subscribers registered on the observability `EventBus`. Every
production event — `PAYMENT_SUCCEEDED`, `InvoiceOverdue`, `LeaseTerminated`,
`CaseSLABreached`, `WorkOrderCompleted` — was silently dropped.

**Fix:**

- `services/domain-services/src/common/events.ts` — added `ALL_EVENTS`
  wildcard token, `EventForwarder` type, and `addForwarder()` /
  `subscribe('*', …)` surfaces on `InMemoryEventBus`. Publish now fans
  out to direct-match handlers, wildcard handlers, and every
  registered forwarder. Handlers and forwarders are isolated so one
  throwing listener cannot block siblings.
- `services/api-gateway/src/index.ts` (around the existing
  `registerDomainEventSubscribers` call) — installs a forwarder that
  reshapes each domain envelope into the observability `DomainEvent<T>`
  shape (populates both `type` and `eventType`, copies `payload`,
  `metadata.tenantId`, `metadata.correlationId`, `aggregateId`,
  `aggregateType`) and republishes onto the observability bus. The
  outbox drainer picks it up on its 5s tick and delivers to the 124
  subscribers.
- `services/domain-services/src/common/events.test.ts` — new unit
  tests (6 cases) verify exact-match, wildcard, forwarder, isolation,
  and unsubscribe behaviour.

## Ghost subscribers fixed

**Finding #2 (document-only, no fix applied):**
`packages/ai-copilot/src/org-awareness/event-subscribers.ts` (wired via
`buildOrgAwareness` in the composition root) registers 21 subscribers
on dotted event types — `maintenance.case.reported`,
`maintenance.case.triaged`, `maintenance.case.assigned`,
`maintenance.case.in_progress`, `maintenance.case.resolved`,
`maintenance.case.reopened`, `lease.renewal.drafted`,
`lease.renewal.sent`, `lease.renewal.accepted`, `lease.renewal.declined`,
`arrears.case.opened`, `arrears.case.notice_sent`,
`arrears.case.escalated`, `arrears.case.closed`, `payment.reconciled`,
`approval.decided`, `tender.bid.submitted`, `tender.bid.awarded`,
`inspection.completed`, `letter.generated`, `training.completed`.

**No production code publishes any of these dotted names.** The domain
services use PascalCase (`WorkOrderCreated`, `RenewalAccepted`, etc.),
and the only references to the dotted names are in the subscriber
itself and its tests. This is dead wiring — the process-miner receives
no observations in production.

**Not fixed in this scope** (Agent E owns the process-miner / org-awareness
domain per scope rules; the correct fix is either (a) map the existing
PascalCase events to the miner's dotted taxonomy inside the bridge, or
(b) rename the miner's subscribe list to match the PascalCase publishes).
Logged here as a follow-up. Agent F did not touch
`packages/ai-copilot/src/org-awareness/*`.

**Finding #3 (documented):** The ghost publishers list above — `ScanBundle*`,
`DocChat*`, `ComplianceExportRequested`, `DocumentRenderRequested`,
`ActionPlanAcknowledged`, `NotificationDeliveryStatus`,
`NotificationDeliveryFailed`, `GdprDeletion*`, `MessageRead`,
`ConversationClosed`, `training.*` — emit into the bus with no listener.
These are audit-trail events intended for future handlers (e.g. a
future webhook fan-out, future analytics sink). The bridge now delivers
them to the observability bus so a single future subscriber can listen
once and capture every producer. No deletions performed — the emits
are useful scaffolding.

## Idempotency gaps fixed

The existing `InvoiceOverdue → arrears auto-open` subscriber in
`services/api-gateway/src/workers/event-subscribers.ts:781-878` already
relies on repo-layer idempotency for (tenantId, customerId, invoiceId).
That contract is documented in-line and is the right answer for
at-least-once delivery.

Other subscribers (notifications dispatch) are idempotent at the
notifications-service layer via `idempotency-key` headers propagated
through `correlationId`. The bridge preserves `correlationId` in the
forwarded event metadata so receivers can dedupe.

**No new idempotency gaps introduced** by the bridge. The bridge is
itself at-most-once per domain publish (the domain bus calls forwarders
sequentially after handlers), and the observability bus outbox gives
at-least-once after that point — which is the documented contract.

## DLQ / retry gaps fixed

- Domain bus forwarder errors are caught per-forwarder (no process
  crash), logged via `console.error` (keeps parity with existing domain
  bus error handling; structured pino logger is not in scope for the
  domain bus — caller's concern).
- Domain bus handler errors are caught per-handler; fix also removes
  a latent bug where a single throwing subscriber blocked all
  subsequent subscribers for the same event type because the original
  `for`-of loop rethrew.
- `webhook-retry-worker.ts` (verified, no change required): correct
  5-attempt retry ladder `[1, 3, 9, 27, 81]` seconds; 2xx=success,
  5xx/network=retryable, 4xx=permanent; persists attempt record on
  every try; moves to `webhook_dead_letters` table on exhaustion; HMAC
  signature + timestamp per delivery.
- `outbox-worker.ts` (verified, no change required): drainer is
  crash-safe (`try/catch` around `processOutbox`), re-entrant-safe
  (`running` flag prevents overlapping ticks), and kicks off one
  immediate drain at boot so queued events do not idle until the first
  interval.

## Tenant-isolation issues fixed

The bridge copies `tenantId` from `domainEvent.tenantId` into
`metadata.tenantId` on the observability side. All 124 subscribers
read `event.metadata?.tenantId` via the `extractTenant` helper and
skip processing when missing — verified by reading every
`bus.subscribe(...)` block in `event-subscribers.ts`. The arrears
auto-opener, notifications dispatcher, and audit-log sink all
tenant-scope their writes. No leak introduced.

**One existing pattern noted, not in scope:** `api-gateway/index.ts:481`
publishes `NotificationDeliveryStatus` with `tenantId: 'system'` — a
synthetic scope for platform-level events. Flagged here for review but
not touched; it is behaviourally correct for a webhook-status ping that
spans tenants.

## Deferred (with reason)

1. **Org-awareness dotted event names** — Agent E's scope per the
   Wave 19 plan. The right fix is either a taxonomy map inside the
   bridge or renaming the 21 subscribed dotted names to the PascalCase
   equivalents the domain services actually emit. Documented above.
2. **Wave 12 `type:` vs `eventType:` field drift** — the observability
   bus uses `type`; the domain bus uses `eventType`; route-handlers
   sometimes use `eventType` inside an envelope. The bridge writes
   both fields and all 124 subscribers fall back `eventType ?? type`,
   so the drift is papered over. A deeper fix would unify the field
   name across both buses, but that is a whole-package refactor that
   violates the Wave 19-F scope ("event wiring only").
3. **Ghost publishers without subscribers** (ScanBundle*, DocChat*,
   GdprDeletion*, MessageRead, ConversationClosed, NotificationDeliveryFailed,
   training.*, etc.) — kept, not deleted. They are useful audit-trail
   emissions. Once the bridge lands, any future subscriber added for
   one of these names picks up all historical producers.
4. **`packages/ai-copilot/src/training/training-assignment-service.ts`
   `type: 'training.assigned'` field drift** — uses `type` not
   `eventType`. Its immediate publishes go through a dedicated shim
   (`service-registry.ts:642`) that wraps into an envelope, and the
   observability bus only has `ProcedureTrainingCompleted` subscribers.
   Not a production hit path today; flagged for taxonomy alignment
   with org-awareness work above.
5. **Role-gate test failures** (6 failing tests in
   `services/api-gateway/src/routes/__tests__/role-gate.test.ts`) —
   untracked test added by another Wave 19 agent, unrelated to event
   wiring, not in F's scope.
6. **`packages/ai-copilot/src/personas/sub-personas/finance-persona.ts`
   pre-existing TS1005 syntax error** — unrelated to F's scope.

## Verification commands run

    pnpm --filter @borjie/domain-services typecheck   # clean
    pnpm --filter @borjie/api-gateway typecheck       # clean
    pnpm --filter @borjie/domain-services test        # 339 passed (48 files)
    pnpm --filter @borjie/api-gateway test -- \
      event-subscribers.test outbox-worker.test           # 15 passed (2 files)

## Files touched

- `services/domain-services/src/common/events.ts` — wildcard `*` +
  forwarder surface on `InMemoryEventBus`; per-handler / per-forwarder
  error isolation.
- `services/domain-services/src/common/events.test.ts` (new) — 6-case
  unit test for the new surface.
- `services/api-gateway/src/index.ts` — installs the bridge forwarder
  after `registerDomainEventSubscribers`, reshaping domain envelopes
  into the observability `DomainEvent<T>` contract.
