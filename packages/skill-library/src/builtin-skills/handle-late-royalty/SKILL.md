---
name: handle-late-royalty
description: Walk a late-royalty ticket through the grace -> first-notice -> second-notice -> escalation ladder, idempotently, with attribute writes to the entity-store at every step.
when_to_use:
  - counterparty royalty past due
  - counterparty 5+ days late
  - late-payment escalation
  - missed-royalty reminder due
allowed_tools:
  - Read
  - Write
jurisdiction_aware: true
code_entrypoint: ./handle-late-royalty.skill.ts
version: 1.0.0
---

# Handle Late Royalty

When a counterparty is past their royalty due date, this skill walks the
matter through the standard ladder configured for the operator's
jurisdiction:

1. **Grace window** (configurable, default 5 days): no action, no fees.
2. **First notice**: friendly reminder via the counterparty's preferred channel.
3. **Second notice**: formal letter, late-fee triggered (jurisdiction rate).
4. **Escalation**: legal-team alert, payment-plan offer attached.

The skill writes one `late_royalty_event` attribute per step, idempotent by
provenance hash. Re-running the skill never duplicates an event.

It NEVER waives royalties, NEVER terminates an offtake agreement, and NEVER
initiates a licence-suspension — those are explicit four-eye actions
requiring autonomy-gated operator approval (see `autonomy-governance`
package).
