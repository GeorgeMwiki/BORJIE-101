# maintenance.dispatch — Tier-A sub-MD

Triage incoming equipment-maintenance tickets → pick best-fit contractor
→ dispatch a **reversible** work order → follow up with the requester.

## Tools

| Tool                                    | Tier   | Notes                                              |
|-----------------------------------------|--------|----------------------------------------------------|
| `maintenance.classify_ticket`           | read   | Bilingual (Swahili + English) lexical classifier   |
| `maintenance.pick_contractor`           | read   | Filters by skill ∩ area, scores by quality+SLA+cost |
| `maintenance.dispatch_work_order`       | mutate | Reversible inside `recall_window_ms` (default 30s) |
| `maintenance.follow_up`                 | read   | Drafts requester follow-up; queued for owner review |

## Equipment categories

`pumping` (dewatering / slurry / borehole), `electrical`, `hydraulics`,
`processing` (crusher / mill / wash plant), `vehicle` (haul fleet),
`structural` (civil / headframe / ramp), `safety` (gas detector,
ventilation, fire suppression), and `general` (signage, housekeeping).

## Risk tier

`mutate` — reversible within the recall window. 4-eye not required (Tier-A).
Audit-trail mandatory. Off-boarded contractors are never picked.

## Evidence (R3 audit)

- 45% emergency-response reduction across contractors
- 15-20% spend reduction
- 89-96% classification accuracy (up to 98% with reasoning models, vs.
  60-70% manual baseline)
- No documented major-failure cases
