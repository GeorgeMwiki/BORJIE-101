# Payments-Ledger Codemap

**Last Updated:** 2026-05-22
**Module:** `services/payments-ledger/`
**Public entry:** `services/payments-ledger/src/index.ts`
**Tier scope:** tenant-scoped (RLS GUC enforced); admin reconciliation cross-tenant via signed ops only.

## Purpose

Immutable double-entry ledger and payment orchestration. Owns the
money path: payment intents, ledger postings, bank reconciliation,
statement + invoice generation, owner disbursements, M-Pesa B2C
payouts. CRITICAL service — every monetary side effect either
posts through `LedgerService.post()` or breaks the audit chain.

## Entry points

- `LedgerService` — `src/services/ledger.service.ts` (post + fetch).
- `PaymentOrchestrationService` — `src/services/payment-orchestration.service.ts`.
- `ReconciliationService` — `src/services/reconciliation.service.ts`.
- `StatementGenerationService` — `src/services/statement-generation.service.ts`.
- `DisbursementService` — `src/services/disbursement.service.ts`.
- Providers: `providers/stripe-provider.ts`, `providers/mpesa-provider.ts`,
  `providers/payment-provider.interface.ts`.
- Server: `src/server.ts` (Hono routes for webhooks + admin ops).

## Internal structure

- `providers/` — Stripe + M-Pesa Daraja STK + B2C adapters; EFT stub
  for non-mpesa rails.
- `services/` — orchestration, ledger, reconciliation, statement gen
  (PDF-1.4 pure-TS writer), invoice gen, disbursement.
- `repositories/` — Drizzle repos for `payment-intent`, `ledger`,
  `account`, `statement`, `disbursement`. Tenant predicate enforced
  per query.
- `arrears/`, `events/` (payment-events + event-publisher / outbox),
  `jobs/`, `lib/`, `middleware/` (tenant context + RLS bind).

## Dependencies

- Upstream: `services/api-gateway` (webhook routes + admin BFF),
  `services/webhooks` (M-Pesa STK + Stripe Web Events).
- Downstream: `packages/database` (immutable ledger schemas), Inngest
  + outbox-processor (eventual consistency), Twilio + Africa's Talking
  (notification fanout via `services/notifications`).

## Common workflows

- **Record a payment** → webhook handler resolves tenantId → call
  `paymentOrchestration.recordWebhookPayment()` → posts debit/credit
  via `LedgerService.post()` (idempotent on `external_ref`).
- **Generate owner statement** → cron triggers
  `StatementGenerationService.runMonthlyClose()` → renders A4 PDF-1.4
  with SHA-256 audit hash in `/Keywords`.
- **Disburse to owner** → `DisbursementService.payout()` routes
  `(KES + msisdn)` → M-Pesa B2C with OriginatorConversationID
  idempotency; else → EFT stub (returns `failed` so DLQ).
- **Reconcile bank statement** → upload → match by `external_ref` +
  amount + ISO date.
- **Tenant predicate enforcement** → `middleware/tenant-context.ts`
  binds `app.current_tenant_id` GUC per request; repos `WHERE
  tenant_id = current_setting('app.current_tenant_id')`.

## Anti-patterns to avoid

- Never bypass `LedgerService.post()` — direct writes to ledger tables
  break the immutable double-entry invariant.
- Never mutate a posted ledger row — always post a reversing entry.
- Never trust `tenant_id` from request body — derive from
  authenticated context.
- Never log webhook secret or raw signature — sanitise in errors.
- Never widen the `Money` type without auditing all currency-affecting
  consumers (135 owner-portal callsites already threaded).

## Related codemaps

- [database.md](./database.md) — ledger schemas, migrations 0169 +
  0174 + 0176 (RLS + repos + owner_statements)
- [api-gateway.md](./api-gateway.md) — webhook routes + composition
- [observability.md](./observability.md) — money-path audit events
