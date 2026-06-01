---
name: chase-outstanding-royalties
description: Roll up counterparty outstanding royalties into payment-plan proposals based on debt size, days outstanding, and counterparty payment history. Writes one `outstanding_royalty_action` entity per chased counterparty.
when_to_use:
  - outstanding-royalty review due
  - operator asks to chase outstanding royalties
  - aged-debt collection cycle
  - end-of-month outstanding review
allowed_tools:
  - Read
  - Write
jurisdiction_aware: false
code_entrypoint: ./chase-outstanding-royalties.skill.ts
version: 1.0.0
---

# Chase Outstanding Royalties

Given a batch of outstanding-royalty items, this skill proposes a chase
action per counterparty from a deterministic decision table:

| Days late | Avg history | Action |
|---|---|---|
| 1-30 | good payer (≥0.9 on-time ratio) | `reminder_only` |
| 1-30 | spotty (0.5–0.9) | `payment_plan_offer` |
| 1-30 | bad (<0.5) | `escalate_to_operator` |
| 31-60 | any | `payment_plan_offer` |
| 61-90 | any | `escalate_to_operator` |
| 90+ | any | `legal_review_requested` |

The skill is currency-neutral — the same logic runs against TZS, KES,
UGX, USD, NGN. Decision thresholds are configurable via the entity-store
`outstanding_royalty_policy` entity (skill defaults if absent).

The skill is jurisdiction-NEUTRAL — `legal_review_requested` is a flag,
not a legal action. Downstream jurisdiction plugins translate the flag to
a jurisdiction-specific filing.
