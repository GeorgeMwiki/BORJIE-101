# Webhook receivers — operational contract

Authoritative answer to: *"why does Borjie return 200 instead of 202?"*
and *"what is the idempotency contract?"* Audience: SREs, integration
partners (M-Pesa, Stripe, GePG), auditors.

| Provider | Route | Handler |
|----------|-------|---------|
| M-Pesa | `POST /api/v1/webhooks/mpesa`  | `services/api-gateway/src/routes/webhooks/mpesa.hono.ts`  |
| Stripe | `POST /api/v1/webhooks/stripe` | `services/api-gateway/src/routes/webhooks/stripe.hono.ts` |
| GePG   | `POST /api/v1/webhooks/gepg`   | `services/api-gateway/src/routes/webhooks/gepg.hono.ts`   |

## 1 — Status codes: why 200, not 202

Borjie returns **`200 OK`** on every successfully verified webhook,
even though the actual work (ledger posting, reconciliation) is queued
to the outbox worker. RFC 7231 §6.3.3 reserves 202 Accepted for
"request accepted for processing, but processing not yet completed,"
which technically describes us. We choose 200 anyway because:

- **M-Pesa retry semantics treat any non-2xx as retryable** but only
  count `200` as "delivered" in the partner dashboard. A 202 lights up
  Safaricom's monitoring as "non-ideal acknowledgement" and triggers
  manual ops follow-up. Stripe and GePG behave the same way in
  practice — every webhook spec example uses 200, never 202.
- **Our durability guarantee is the same either way.** The outbox row
  is inserted in the SAME transaction as the receiver's response
  decision; if we return 200 the row is committed, if we return 5xx
  the txn rolls back. There is no race where 200 is sent but the work
  is lost.
- **Operators read 200 as "received and queued."** The dispatch
  worker emits its own metrics (`outbox_dispatch_total`,
  `webhook_processing_duration_ms`) so the async leg is observable
  without overloading the HTTP status code.

If a future receiver legitimately needs 202 (upstream requiring a
callback for final ack), add it to the table above and confirm
`webhook-idempotency.middleware.ts` already caches 200–299 (it does).
This file closes G7 from `Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`.

## 2 — Idempotency contract

Every receiver dedups on `(provider, external_id)` where:

- `provider` is the literal string `mpesa` / `stripe` / `gepg`
- `external_id` is the provider's transaction identifier (M-Pesa
  `CheckoutRequestID`, Stripe `event.id`, GePG `GepgReceiptNumber`)

The dedup table is `webhook_inbox`. UNIQUE constraint on
`(provider, external_id)` makes the de-dup atomic at the DB layer;
duplicate inserts trip `23505 unique_violation` which the receiver
translates into a replay-cached response.

**Replay behaviour:** when a duplicate arrives, the receiver returns
the EXACT response (status + body) from the original delivery. Cached
in Redis for 24h via `webhook-idempotency.middleware.ts`. Clients
sending the optional `Idempotency-Key` header get the same response
keyed by that header instead of `(provider, external_id)` — useful
for clients replaying a manually-resent webhook from a partner
dashboard.

## 3 — Signature verification

Every receiver verifies the request signature BEFORE touching the
database. The verifier is HMAC-SHA256 with constant-time comparison
(`crypto.timingSafeEqual`) — never `===` on the digest string. The
M-Pesa fix in commit `9facfc79` (see audit row 14) replaced a stub
`return true` with a real verifier; the Stripe and GePG paths were
already correct.

Failure modes:

- **Wrong signature** → `401 Unauthorized` with body
  `{ "error": "signature_invalid" }`. No log of the payload (might
  contain partial PII); a redacted hash of the body is logged for
  audit.
- **Missing signature header** → `401` with `signature_missing`.
- **Missing webhook secret in env** → receiver fails CLOSED with
  `500 webhook_secret_unconfigured` rather than accepting unsigned
  traffic. The boot wiring in `services/api-gateway/src/index.ts`
  surfaces the missing env on startup so this should never fire in
  prod.

## 4 — Failure modes (4xx vs 5xx)

| Status | Cause | Retry |
|--------|-------|-------|
| 401 | HMAC mismatch / missing signature | NO — partner triages. |
| 400 | Zod payload schema fails          | NO — payload structurally wrong. |
| 422 | `external_id` does not map to a tenant | NO — ops triages routing. |
| 200 | Replay of stored hash (cached)    | YES (free — returns cached body). |
| 503 | Postgres / Redis pool empty       | YES with backoff. |
| 500 | Outbox insert failed              | YES — we page SRE on this. |

Receivers NEVER swallow errors to return 200; the durability invariant
in §1 depends on 5xx ⇔ outbox row not committed. The receiver returns
5xx and Postgres rolls back the transaction together.

— Ops, robustness audit closure (G7)
