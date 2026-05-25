---
name: lease-renewal
description: Use this skill when a tenant's lease is within 90 days of expiry and the operator wants to draft a renewal offer with market-rate guidance, send notice, capture acceptance, and update the lease record. Triggers on "renew lease", "lease expiring", "renewal offer", "send renewal notice". Operates per tenant jurisdiction (TZ/KE/UG/NG) and never auto-sends — drafts only.
tools: Read, Write, Edit, Bash, Grep
---

# Lease Renewal — BORJIE operator skill

## When this fires

Operator asks BORJIE AI to handle a renewal. The lease must be within 90 days of expiry and the tenant must be in good standing (no severity-`refuse` constitution violations open).

## Workflow

1. **Read state** — fetch the lease row, the tenant row, the property row, the 12-month payment ledger, and any open maintenance tickets.
2. **Market signal** — call `market-intelligence` for the comparable rent range for this unit class in this district (last 90 days).
3. **Risk signal** — call `credit-rating` for the tenant's current bracket (Self-RAG enforced: every numeric claim must be DB-grounded).
4. **Compose renewal terms** (DRAFT — do not commit yet):
   - new rent (within ±10% of comparable market, with rationale)
   - new term length (12 months default; 24 months if tenant offered ≥2-mo discount)
   - any update to deposit caps per jurisdiction (see Constitution C04)
   - effective date + notice period (per Constitution C01)
5. **Validate against Constitution** — pass the draft through `verifyResponse` from `@borjie/autonomy-governance`. Block if any `refuse` clause fires; downgrade and surface warnings for `warn` clauses.
6. **Present** the draft renewal to the operator with a side-by-side diff against current terms.
7. **On operator approve** — draft the notice document via `@borjie/document-studio` (template: `lease-renewal-offer/<jurisdiction>`), queue for tenant signature via Dropbox Sign, write nothing to the lease record yet.
8. **On tenant signature** — atomically update lease + write payment-plan rows + send confirmation. Always idempotent on `lease.id + renewal_id`.

## Hard rules

- **NEVER auto-send** the renewal notice. Operator must approve.
- **NEVER bypass** the credit-rating Self-RAG check.
- **ALWAYS** persist the original portal + role at queue time (see `packages/mcp-server/src/safety/tier-policy-guard.ts`) so privilege-laundering cannot fire a renewal under a downgraded tier.

## Failure modes

- If the comparable-rent query returns < 5 samples for the district, FALL BACK to the city-level range and flag the renewal as `low-confidence` (confidence-band routes < 0.7 → escalate).
- If the tenant has an open eviction process, REFUSE the renewal and surface the eviction case ID instead.

## Outputs

- `renewal_offer.docx` (draft, watermarked DRAFT)
- `renewal_summary.json` (terms, market-rate evidence, risk signal, audit trail)
- A new entry in the brain-event-bus: `lease.renewal.proposed`
