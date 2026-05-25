---
name: dispatch-maintenance
description: Triage an inbound maintenance ticket, pick a vendor by category + locality + score, attach SLA based on severity, and write `maintenance_dispatch` to the entity-store.
when_to_use:
  - new maintenance ticket created
  - vendor needs assignment
  - severity-3 leak or outage
  - dispatch decision needed
allowed_tools:
  - Read
  - Write
jurisdiction_aware: false
code_entrypoint: ./dispatch-maintenance.skill.ts
version: 1.0.0
---

# Dispatch Maintenance

Given a new ticket and a candidate vendor list, this skill picks the
right vendor by a deterministic scoring rule:

```
score = 0.4 * locality_match
      + 0.3 * category_match
      + 0.2 * vendor_rating / 5
      + 0.1 * 1/(1 + open_tickets)
```

It assigns an SLA derived from severity:

- severity 1 (catastrophic / safety): respond ≤ 1 hour, resolve ≤ 4 hours.
- severity 2 (urgent, e.g. no water/no power): respond ≤ 4 hours, resolve ≤ 24 hours.
- severity 3 (normal): respond ≤ 24 hours, resolve ≤ 72 hours.
- severity 4 (cosmetic): respond ≤ 72 hours, resolve ≤ 14 days.

The skill writes a single `maintenance_dispatch` entity. It does NOT send
notifications — that's a downstream routing concern.
