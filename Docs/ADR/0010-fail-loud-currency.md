# ADR 0010 — Fail-loud currency on the money path

- **Status:** Accepted
- **Date:** 2026-04 (W4-A + Wave 12 security review)

## Context

A pre-Wave-4 bug in `payments-ledger` allowed a payment write with
a missing or wrong currency code to default to `KES`. With M-Pesa
launching in Tanzania (TZS) and Nigeria (NGN), this default silently
mis-priced cross-border test transactions in development and could
have caused real cross-currency misposting in production. The
audit DA1 surfaced this as the single highest-severity money-path
finding.

Options considered:

| Option | Verdict |
|---|---|
| Default to tenant base currency | Inherits the original bug pattern |
| Default to USD | Worse — hides issue in a third currency |
| Reject + 400 with explicit error | Selected |
| Auto-convert via FX rate | Adds undeclared FX risk; rejected |

## Decision

Every write to `payments-ledger.payments`, `disbursements`,
`statements_lines`, and any new money-path table requires an
explicit, valid ISO-4217 currency. Missing → 400 with a typed
error. Wrong format → 400. Mismatch with tenant base currency
without an explicit `cross_currency_intent` flag → 400. The
ledger repository constructor refuses to instantiate without a
currency resolver.

## Consequences

**Positive:**

- Cross-currency mis-posts are now compile-time + run-time impossible.
- Audit DA1's CRITICAL finding closed.
- Downstream UI (135 owner-portal callsites, W4-I1) now passes
  tenant currency through `formatCurrency` everywhere.
- The pattern enforces honesty about FX intent.

**Negative:**

- Callers that previously relied on the default must explicitly
  pass currency. ~135 callsite updates were needed.
- Stale tests that omitted currency had to be updated.
- Slight onboarding friction; mitigated by a TS error if omitted.

## Alternatives considered

Auto-converting via FX is the long-term direction but requires an
FX-rate provider + audit + tenant approval — out of scope for
Wave 4. Currently we reject and let the operator pick.

## References

- `services/payments-ledger/src/server.ts` — fail-loud writes
- `packages/api-client/src/currency.ts` — formatter
- Audit DA1 (task 48), W4-A (task 52), W4-I1 (task 64)
- `Docs/CODEMAPS/payments-ledger.md`
