# Webhooks Service Codemap

**Last Updated:** 2026-05-22
**Module:** `services/webhooks/`
**Public entry:** `services/webhooks/src/index.ts`
**Tier scope:** platform spine (outbound webhook delivery)

## Purpose

Outbound webhook subscriptions + delivery for tenants who want to
receive Borjie events in their own systems. Subscribers
register an HTTPS endpoint + filter; delivery is signed
(HMAC-SHA256), retried with exponential backoff, and recorded for
idempotency. Companion to the inbound webhook handlers (M-Pesa,
Stripe) that live in payments-ledger.

## Entry points

- `src/index.ts` — barrel.
- `src/types.ts` — `WebhookSubscription`, `WebhookEvent`,
  `DeliveryAttempt`.
- `src/delivery.ts` — `deliver(event, subscription)`.
- `src/webhook-service.ts` — `WebhookService` (subscribe,
  unsubscribe, trigger, list).
- `src/delivery.test.ts` — delivery tests.

## Internal structure

- `delivery.ts` — HTTP POST + HMAC + retry policy.
- `webhook-service.ts` — CRUD + dispatch.
- Persistence and idempotency tables live in `@borjie/database`.

## Dependencies

- Upstream: `@borjie/observability` (audit + retries),
  `@borjie/database`, `@borjie/config`.
- Downstream: tenant systems, audit log.

## Common workflows

- **Subscribe** → `webhookService.subscribe({ tenantId, url, events, secret })`.
- **Trigger** → `webhookService.trigger({ tenantId, event })` →
  matches subscriptions → enqueues `deliver`.
- **Deliver** → sign body, POST, retry on `5xx` / network error.
- **Verify on receiver** → check `X-Borjie-Signature` HMAC.

## Anti-patterns to avoid

- Never deliver to private CIDR ranges (SSRF — guard applies).
- Never log subscription secrets.
- Never retry indefinitely — exponential backoff with hard cap.
- Never deliver same event twice without idempotency key.

## Related codemaps

- [payments-ledger.md](./payments-ledger.md) — inbound webhooks (M-Pesa/Stripe)
- [database.md](./database.md) — subscriptions table
- [observability.md](./observability.md) — delivery metrics
