---
name: handle-late-rent
description: Walk a late-rent ticket through the grace -> first-notice -> second-notice -> escalation ladder, idempotently, with attribute writes to the entity-store at every step.
when_to_use:
  - tenant rent past due
  - tenant 5+ days late
  - late-payment escalation
  - missed-rent reminder due
allowed_tools:
  - Read
  - Write
jurisdiction_aware: true
code_entrypoint: ./handle-late-rent.skill.ts
version: 1.0.0
---

# Handle Late Rent

When a tenant is past their rent due date, this skill walks the matter
through the standard ladder configured for the tenant's jurisdiction:

1. **Grace window** (configurable, default 5 days): no action, no fees.
2. **First notice**: friendly reminder via the tenant's preferred channel.
3. **Second notice**: formal letter, late-fee triggered (jurisdiction rate).
4. **Escalation**: legal-team alert, payment-plan offer attached.

The skill writes one `late_rent_event` attribute per step, idempotent by
provenance hash. Re-running the skill never duplicates an event.

It NEVER waives rent, NEVER terminates a lease, and NEVER initiates an
eviction — those are explicit four-eye actions requiring autonomy-gated
operator approval (see `autonomy-governance` package).
