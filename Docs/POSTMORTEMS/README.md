# Post-Mortems

Blameless post-mortems for every incident that paged primary on-call or
caused customer-visible downtime. The point of this directory is to make
the lessons retrievable; the point of the post-mortem itself is to fix the
underlying system, never to assign blame.

## When to write a post-mortem

A post-mortem is **mandatory** for any incident matching:

- Severity **P0** at any duration.
- Severity **P1** lasting longer than 1 hour.
- Any **data-integrity** event (wrong tenant sees another tenant's rows,
  ledger imbalance, lost write).
- Any **security** event (suspected breach, leaked credential, exploited
  vulnerability).
- Any **regulatory** event (missed compliance deadline, regulator inquiry).

Post-mortems are **optional but encouraged** for:

- P2 incidents that surfaced an unknown failure mode.
- Near-misses where automation prevented a P0 (capture how!).
- Repeat P3 flakiness that crosses 3 occurrences in 30 days.

## SLA for filing

| Severity | Draft due | Published due |
|---|---|---|
| P0 | 48 h after resolution | 7 days after resolution |
| P1 (>1 h) | 5 days after resolution | 14 days after resolution |
| Data / security / regulatory | 24 h after detection | 5 days after resolution |

These SLAs come from `Docs/OPERATIONS.md §1.3` ("On resolve, open a
blameless post-mortem within 48 h.") and the incident-response runbook
`Docs/RUNBOOKS/incident-response.md`.

## Naming convention

```
YYYY-MM-DD-<short-kebab-case-title>.md
```

The date is the **start** of the incident in UTC, not the publish date.
Examples:

- `2026-05-12-gepg-signature-rotation.md`
- `2026-02-03-payments-ledger-imbalance.md`
- `2026-01-19-anthropic-rate-limit-cascade.md`

Use the title to make the indexed list (below) scannable — prefer
"what broke" over "what we did about it".

## Severity-tier definitions

Mirrors the severity ladder in `Docs/OPERATIONS.md §1.1` and the incident
matrix in `Docs/RUNBOOKS/incident-response.md`.

| Tier | Public-facing impact | Examples | Pager response |
|---|---|---|---|
| **P0** | Full platform down, data loss, paid tenants cannot transact | Gateway returning 5xx >50%, ledger imbalance, regional outage | Primary + secondary paged immediately |
| **P1** | Major feature down for >5% of tenants | Payments degraded, auth failing intermittently, OCR provider down with no fallback | Primary paged, exec notified |
| **P2** | Degraded experience, workarounds exist | Slow reports, occasional notification delay, partial dashboard staleness | Ticketed, addressed business hours |
| **P3** | Cosmetic / no user impact | Log spam, dev-env flakiness, internal dashboard glitch | Backlog |

Data / security / regulatory events override the impact tier:

- **DATA-INTEG** — any cross-tenant data leak or ledger imbalance is
  treated as P0 regardless of customer count affected.
- **SEC-INC** — any suspected breach is treated as P0; publishes go
  through `Docs/COMPLIANCE/INCIDENT_DISCLOSURE.md`.
- **REG-INC** — any regulator-reportable event is treated as P0 with
  the addition of a regulatory-notification action item.

## Template

Every post-mortem starts from [`TEMPLATE.md`](./TEMPLATE.md). The template
is Anthropic-style 5-whys: summary -> timeline -> impact -> root cause
analysis (5-whys laddered) -> action items -> lessons. Do not delete
sections; if a section doesn't apply, write "N/A — <reason>".

## Index

Add a row here when you create a new post-mortem. Keep newest at the top.

| Date | Title | Severity | Duration | File |
|---|---|---|---|---|
| _none yet_ | _no incidents on this platform have been post-mortemed in this directory yet — first one will land here._ | — | — | — |

## Cross-links

- Incident-response process: [`../RUNBOOKS/incident-response.md`](../RUNBOOKS/incident-response.md)
- Operations runbook (severity ladder, escalation path): [`../OPERATIONS.md`](../OPERATIONS.md)
- KPIs / SLOs (what the error budget is): [`../KPIS_AND_SLOS.md`](../KPIS_AND_SLOS.md)
- Backup-restore drill log: [`../RUNBOOK.md`](../RUNBOOK.md#quarterly-backup-restore-drill-schedule)
