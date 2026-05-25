# complaint.triage — Tier-A sub-MD

Classify, route, draft empathy response, and escalate when needed.
Bilingual (Swahili + English). Every tenant-facing reply is DRAFTED and
queued for owner review — never auto-sent.

## Tools

| Tool                              | Tier   | Notes                                              |
|-----------------------------------|--------|----------------------------------------------------|
| `complaint.classify`              | read   | category × severity × sentiment × language          |
| `complaint.route`                 | mutate | Routes to maintenance / billing / owner / legal / community / general |
| `complaint.empathize_response`    | draft  | Always queued for owner review; never auto-sent     |
| `complaint.escalate_when_needed`  | mutate | Escalation matrix (safety, fair-treatment, privacy) |

## Escalation matrix

| Category × Severity              | Channel                | SLA   | Tags    |
|----------------------------------|------------------------|-------|---------|
| safety × critical                | owner-direct-phone     | 60m   | safety  |
| safety × non-critical            | owner-direct-phone     | 240m  | safety  |
| fair-treatment / privacy         | owner-direct-phone     | 60/240m | legal |
| maintenance × urgent             | maintenance-fast-lane  | 240m  | maintenance |
| billing × urgent                 | billing-fast-lane      | 240m  | billing |
| neighbor-noise (non-chatter)     | standard-queue         | 1440m | community |
| chatter (anywhere)               | standard-queue         | 4320m | —       |

## Risk tier

`mutate` — reversible routing decisions. 4-eye not required (Tier-A), but
the empathy-response tool can NEVER auto-send (its tier flag is
`autoSendable: false`).

## Evidence (R3 audit)

- 89-96% BERT-style classification accuracy on labelled corpora
- Well-studied — every decision is human-confirmable
- No documented major-failure cases
