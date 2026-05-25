# Incident Response — First 15 Minutes

**Scope**: what to do when a production pager fires. Deep playbooks for
specific outage classes (OCR down, GePG signature failure, notifications
DLQ, scheduler stuck) live in [`../RUNBOOK.md`](../RUNBOOK.md). Severity
definitions and escalation paths live in
[`../OPERATIONS.md`](../OPERATIONS.md).

---

## 0–15 min Action Matrix

| Severity | Examples                                           | First action                                  | Owner             | Rollback trigger                                      |
| -------- | -------------------------------------------------- | --------------------------------------------- | ----------------- | ----------------------------------------------------- |
| P0       | Gateway down, payments failing, data loss          | Page primary + secondary; open `#incident-<id>` | Primary on-call   | No mitigation in 15 min **or** user-visible data loss |
| P1       | Major feature down for >5% tenants (auth, payments) | Page primary; post status in `#status-ops`     | Primary on-call   | No ack within 15 min; error budget burned >50% / hr   |
| P2       | Degraded feature, workarounds exist                | Ticket + Slack notify; investigate business hrs | Primary on-call   | Not applicable — fix forward                          |
| P3       | Cosmetic / flakiness                               | Backlog                                       | Next triage rota  | None                                                  |

Rows mirror the severity ladder in `Docs/OPERATIONS.md:20-27` and the
escalation matrix in `Docs/RUNBOOK.md:376-381`. Do not invent new levels.

---

## Pager Triggers (real alarms wired in prod)

Thresholds come from `Docs/KPIS_AND_SLOS.md:119-138` (critical = PagerDuty,
warning = Slack). Values below are the ones that fire a P0/P1 page.

| Trigger                         | Condition                              | Likely cause                                   | First check                                              |
| ------------------------------- | -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| **API p95 > budget**            | p95 > 1 s for 15 min (warn) / >5 s p99 for 5 min (page) | DB pool saturation, slow query, upstream lag   | `GET /api/v1/health/deep`; check RDS Performance Insights |
| **5xx rate > 1%**               | >1% 5xx over 15 min (warn), >10% 5 min (page) | Bad deploy, upstream down                       | `aws logs tail /ecs/borjie-production-api-gateway`   |
| **DB pool > 90%**               | pool utilization > 90% for any window  | Connection leak, runaway transaction, lock     | `pg_stat_activity` — hunt `idle in transaction`          |
| **Redis memory > 75% maxmemory** | Eviction pressure                      | Cache unbounded, DLQ backlog, session growth   | `redis-cli INFO memory`; inspect biggest keys            |
| **AI cost spike**               | Anthropic/OpenAI spend >2× 7-day baseline in 1 h | Runaway loop in briefing/chat, missing guardrail | `/api/v1/ai-costs-summary`; `Anthropic Console → Usage`  |
| **Payment failures >5%**        | Failure rate >5% over 5 min            | GePG outage, webhook signature failure, PSP 5xx | `Docs/RUNBOOK.md:211-248` (GePG signature playbook)      |
| **Notifications DLQ > 1000**    | Queue depth > 1000                     | Resend/Twilio 429s, malformed recipients       | `Docs/RUNBOOK.md:252-288`                                |
| **Scheduler stale**             | `sla-worker.lastSuccessAt` > 30 min    | Hung handler, DB idle-in-tx                    | `Docs/RUNBOOK.md:292-340`                                |

---

## Response Loop (repeat until P0 downgraded)

1. **Acknowledge** pager. Join `#incident-<id>`.
2. **Classify** against the matrix above. Set severity label in Slack.
3. **Probe**:
   - `curl -sf $PROD_URL/health` and `/healthz` (see
     `Docs/RUNBOOK.md:45-61`).
   - `curl -sf $PROD_URL/api/v1/health/deep` with an admin token —
     every upstream reports healthy/degraded/unhealthy.
   - `scripts/smoke-test.sh` for the impacted region.
4. **Mitigate**. Prefer known playbooks in `Docs/RUNBOOK.md` before
   improvising:
   - OCR down → `Docs/RUNBOOK.md:169-208`
   - GePG signature fail → `Docs/RUNBOOK.md:211-248`
   - Notifications DLQ full → `Docs/RUNBOOK.md:252-288`
   - Scheduler stuck → `Docs/RUNBOOK.md:292-340`
5. **Communicate**. Post in `#status-ops` every 15 min until resolved.
6. **Decide rollback** when the matrix condition fires (see next section).

---

## Rollback Triggers

Rollback rather than fix-forward when ANY of the following hold:

- 15 min elapsed on a P0 with no mitigation in sight.
- A migration ran in the last deploy and errors correlate with a schema
  change. Stop, follow
  [`./migration-production.md`](./migration-production.md) rollback
  playbook.
- Error budget (`Docs/KPIS_AND_SLOS.md:55-61`) burned >50% in a single
  hour for the impacted service.
- Data-integrity symptom (wrong tenant sees another tenant's rows, ledger
  imbalance in `reports/financial-reconciliation`). Freeze writes first.

Rollback mechanics — ECS Fargate task-definition revert, the production
path used today — are in `Docs/RUNBOOK.md:346-370` and
`Docs/OPERATIONS.md:66-83`. Database rollback (compensating migrations,
NEVER `DROP`) is in
[`./migration-production.md`](./migration-production.md).

---

## After the page clears

- Open a blameless post-mortem within 48 h for any incident lasting >1 h
  (`Docs/OPERATIONS.md:42-44`). Start from the template at
  [`../POSTMORTEMS/TEMPLATE.md`](../POSTMORTEMS/TEMPLATE.md) and follow the
  naming + SLA convention in [`../POSTMORTEMS/README.md`](../POSTMORTEMS/README.md)
  (file as `YYYY-MM-DD-<short-title>.md`, append a row to the index).
- If a new failure mode surfaced, append a row to
  `Docs/OPERATIONS.md:109-121` ("Known-Issue Catalog").
- If the pager fired on something not in the table above, add the
  threshold to `Docs/KPIS_AND_SLOS.md` — the alerting config is the
  source of truth.

---

## Cross-links

- Backup + restore drill: [`./backup-restore.md`](./backup-restore.md)
- Tenant-specific rollback (new tenant broken): [`./tenant-onboarding.md`](./tenant-onboarding.md)
- Rate-limit policy (for 429 surges): [`../RATE_LIMITS.md`](../RATE_LIMITS.md)
