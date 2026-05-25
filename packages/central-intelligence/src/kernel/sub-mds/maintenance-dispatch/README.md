# maintenance.dispatch — Tier-A sub-MD

Triage incoming maintenance tickets → pick best-fit vendor → dispatch a
**reversible** work order → follow up with tenant.

## Tools

| Tool                                    | Tier   | Notes                                              |
|-----------------------------------------|--------|----------------------------------------------------|
| `maintenance.classify_ticket`           | read   | Bilingual (Swahili + English) lexical classifier   |
| `maintenance.pick_vendor`               | read   | Filters by skill ∩ area, scores by quality+SLA+cost |
| `maintenance.dispatch_work_order`       | mutate | Reversible inside `recall_window_ms` (default 30s) |
| `maintenance.follow_up`                 | read   | Drafts tenant follow-up; queued for owner review   |

## Risk tier

`mutate` — reversible within the recall window. 4-eye not required (Tier-A).
Audit-trail mandatory. Off-boarded vendors are never picked.

## Evidence (R3 audit)

- 45% emergency-response reduction across vendors
- 15-20% spend reduction
- 89-96% classification accuracy (up to 98% with reasoning models, vs.
  60-70% manual baseline)
- No documented major-failure cases
