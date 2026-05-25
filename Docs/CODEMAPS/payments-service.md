# Payments Service Codemap

**Last Updated:** 2026-05-22
**Module:** `services/payments/`
**Public entry:** `services/payments/src/index.ts`
**Tier scope:** platform spine (M-Pesa STK + reconciliation)

## Purpose

The thin M-Pesa-focused payments service handling **STK Push**,
**C2B confirmation**, and **reconciliation** of M-Pesa pull
exports. Sibling to `payments-ledger` (which is the double-entry
book of record). Payments service is the channel; payments-ledger is
the truth.

## Entry points

- `src/index.ts` — barrel.
- `src/mpesa/stk-push.ts` — `MpesaStkPush`, `StkPushRequest`,
  `StkPushResponse`, `StkQueryRequest`, `StkQueryResponse`.
- `src/mpesa/callback-handler.ts` — `MpesaCallbackHandler`,
  `ParsedStkCallback`, `ParsedC2BPayment`.
- `src/reconciliation/` — recon engine.
- `src/providers/` — provider adapters.
- `src/common/` — shared types/helpers.

## Internal structure

- `mpesa/` — STK + C2B + query.
- `reconciliation/` — daily-export reconciliation.
- `providers/` — additional payment-provider hooks.

## Dependencies

- Upstream: `@borjie/connectors` (resilience),
  `@borjie/observability`, `@borjie/config`, Daraja API.
- Downstream: payments-ledger (writes ledger entries after STK
  confirms), api-gateway, customer-app.

## Common workflows

- **Initiate STK** →
  `mpesaStkPush.initiate({ phone, amount, accountRef })`.
- **Handle callback** →
  `mpesaCallbackHandler.parse(body)` → `payments-ledger.applyPayment`.
- **Reconcile** → daily pull → match → flag exceptions.

## Anti-patterns to avoid

- Never call Daraja without the resilience wrapper.
- Never log Daraja credentials or tokens.
- Never write to the ledger directly from here — go through
  `payments-ledger.applyPayment`.
- Never trust unsigned callback bodies (HMAC verified).

## Related codemaps

- [payments-ledger.md](./payments-ledger.md) — ledger of record
- [connectors.md](./connectors.md) — M-Pesa adapter
- [observability.md](./observability.md) — payment audit
