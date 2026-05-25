# Cron + Supervisor Debug Runbook

> Audience: on-call SRE diagnosing a stuck or misbehaving scheduled
> job. Promoted from `.planning/RUNBOOK.md` §6.1-6.2 with additions
> for every supervisor shipped through Phase D.

## Supervisor inventory

| Supervisor | Source | Default cadence | Owner |
|---|---|---|---|
| `outboxWorker` | `services/api-gateway/src/composition/outbox-worker.ts` | every `OUTBOX_INTERVAL_MS` (default 5000ms) | platform |
| `heartbeatSupervisor` | `services/api-gateway/src/composition/heartbeat.ts` | every 30s | platform |
| `backgroundSupervisor` | `services/api-gateway/src/composition/background-wiring.ts` | task-defined cron strings | platform |
| `intelligenceHistorySupervisor` | `packages/central-intelligence/src/kernel/feedback/history-supervisor.ts` | every 5 min | brain |
| `casesSlaSupervisor` | `services/domain-services/src/cases/cases-sla-supervisor.ts` | every `CASES_SLA_INTERVAL_MS` (default 60000ms) | domain |
| `wakeLoopCron` | `packages/central-intelligence/src/kernel/agency/initiative/wake-loop.ts` | every 5-15 min | brain |
| `idleSessionEmitter` | `packages/central-intelligence/src/kernel/sessions/idle-emitter.ts` | every 2 min | brain |
| `sessionReplayRetention` | `packages/observability/src/session-replay/retention-cron.ts` | daily 02:00 UTC | observability |
| `sovereignLedgerVerifyCron` | `packages/database/src/services/sovereign-action-ledger.service.ts` | daily 03:00 UTC | audit |
| `consolidationRunner` | `services/api-gateway/src/composition/consolidation-runner.ts` | hourly (17 past) | brain |
| `personaDriftCron` (Phase D) | `packages/central-intelligence/src/kernel/persona-drift/cron.ts` | every 30 min | brain |
| `auditVerifyCron` (Phase D) | `packages/ai-copilot/src/security/audit-hash-chain.ts` | daily 04:00 UTC | audit |

## Universal diagnosis recipe

When a supervisor appears stuck, run these checks in order:

### 1. Is the process actually alive?

```bash
# Inside the api-gateway pod
ps -ef | grep -v grep | grep node

# Or via the readyz probe — every supervisor reports last-tick age
curl -fsS "$API_BASE_URL/readyz" | jq '.checks.supervisors'
```

Expected shape:

```json
{
  "outboxWorker":          { "ok": true, "lastTickAgeMs":   3120 },
  "heartbeatSupervisor":   { "ok": true, "lastTickAgeMs":   8500 },
  "wakeLoopCron":          { "ok": true, "lastTickAgeMs": 124100 },
  "auditVerifyCron":       { "ok": true, "lastTickAgeMs": 8400000 }
}
```

If a supervisor's `lastTickAgeMs` exceeds 2× its cadence, it's stuck.

### 2. Check for advisory-lock contention

Most supervisors take a Postgres advisory lock keyed to their name
to prevent concurrent ticks across replicas. Hung locks are the
single most common stuck-state.

```sql
-- All current advisory locks held by supervisors
SELECT pid, locktype, granted, classid, objid, mode
  FROM pg_locks
 WHERE locktype = 'advisory'
 ORDER BY pid;

-- Cross-reference to processes
SELECT pid, state, query_start, NOW() - query_start AS held_for, left(query, 100)
  FROM pg_stat_activity
 WHERE pid IN (SELECT pid FROM pg_locks WHERE locktype='advisory')
 ORDER BY held_for DESC;
```

Held > 5 min on any supervisor = investigate the holding query.
Held > 30 min = likely a wedged process; safe to `pg_cancel_backend(pid)`.

### 3. Tail the supervisor's logs

Every supervisor emits structured log lines with `surface=supervisor:<name>`:

```bash
kubectl logs -l app=api-gateway --since=1h | \
  jq 'select(.surface | startswith("supervisor:"))'
```

Healthy heartbeat (every cadence interval):
```
{"level":"info","surface":"supervisor:outboxWorker","event":"tick.complete","drained":12,"latencyMs":143}
```

Stuck state (no tick.complete in N intervals):
```
{"level":"warn","surface":"supervisor:outboxWorker","event":"tick.skipped","reason":"advisory_lock_held"}
```

## Per-supervisor playbook

### `outboxWorker`

- Healthy log: `event=tick.complete drained=N latencyMs=…`
- Common stuck state: Redis disconnected → backoff loop. Check
  `REDIS_URL` + `redis-cli ping`.
- Recovery: nudge by restarting the gateway pod; the worker rebinds
  the advisory lock on startup.

### `heartbeatSupervisor`

- Healthy log: `event=heartbeat.emit channels=N`
- Stuck state usually means the cross-portal bus is wedged. Check
  Liveblocks rooms via the bus health endpoint.

### `backgroundSupervisor`

- Schedules every entry in `background-wiring.ts`. Healthy log:
  `event=task.start name=<task> cron=<cron>`.
- Common stuck state: one task throws unhandled; supervisor isolates
  but the task itself is skipped. Filter on `name=`.

### `intelligenceHistorySupervisor`

- Trims `kernel_action_audit` to retention window. Healthy log:
  `event=history.trim deleted=N`.
- Stuck state: deletion blocked by FK or by `legal_hold`. Surface
  the row id from the error and clear the hold or re-run.

### `casesSlaSupervisor`

- Watches case-SLA breaches. Healthy log: `event=sla.evaluated breached=N`.
- Set `BORJIE_CASES_SLA_DISABLED=true` to disable for incident
  triage. Re-enable promptly.

### `wakeLoopCron`

- See `.planning/RUNBOOK.md` §6.2 for the canonical reference.
- Stuck state: a single trigger throws. Filter logs by `trigger=`.
- Check `kernel_goals` for stuck `status='open'` rows older than 1h —
  these are missed goals.

### `idleSessionEmitter`

- Emits idle-session events into the bus when no user activity in
  the past 2 min. Healthy log: `event=idle.emit sessions=N`.
- Stuck state usually means the session store is unreachable.

### `sessionReplayRetention`

- Daily 02:00 UTC purge of session-replay chunks older than retention
  policy (`SESSION_REPLAY_RETENTION_DAYS`, default 30).
- Stuck state: S3 client cannot connect. Check `AWS_*` + S3 bucket policy.

### `sovereignLedgerVerifyCron`

- Daily 03:00 UTC verification of `sovereign_action_ledger` chain
  integrity. On mismatch → fires the audit-chain-verification flow.
- Stuck state: see `Docs/RUNBOOKS/audit-chain-verification.md`.

### `consolidationRunner`

- See `.planning/RUNBOOK.md` §6.1.
- Stuck state: ANTHROPIC quota exhausted → all judge calls 429.
  Check the Anthropic dashboard.

### `personaDriftCron`

- Every 30 min: re-evaluates persona-drift signals across active
  sessions. Healthy log: `event=drift.scan sessions=N drift_events=N`.
- Stuck state: typically embeddings provider failure. Check
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` quotas.
- Disable temporarily: kernel still functions; drift detection
  degrades to per-turn only.

### `auditVerifyCron`

- Daily 04:00 UTC random-sample chain verification (`p=0.01`).
- A `mismatch_count > 0` alert is P0 — escalate per
  `Docs/RUNBOOKS/audit-chain-verification.md`.
- Stuck state (no mismatch, no completion log) is usually a DB
  read-timeout. Increase `AUDIT_VERIFY_TIMEOUT_MS`.

## Manually trigger a supervisor

Every supervisor exposes a single-shot CLI entry under `scripts/`:

```bash
# Outbox
pnpm -C services/api-gateway exec node dist/composition/outbox-worker.js --once

# Consolidation
node services/api-gateway/dist/composition/consolidation-runner.js

# Wake-loop
pnpm -C packages/central-intelligence exec node dist/kernel/agency/initiative/run-once.js

# Audit-verify
pnpm -C scripts ts-node verify-audit-chain.ts --sample 0.1
```

A manual run takes the same advisory lock as a scheduled run — safe
to invoke without coordination.

## Common stuck-state signatures

| Signature | Most likely cause |
|---|---|
| All supervisors stuck simultaneously | DB unavailable, or gateway pod CPU pegged |
| One supervisor stuck, rest fine | Advisory lock held by zombie; cancel backend |
| `event=tick.skipped` repeated | Lock held; check `pg_locks` |
| `event=tick.error` repeated | Upstream dependency down (Redis, S3, LLM provider) |
| Supervisor missing from `/readyz` | Not registered in composition; check boot logs |
| `lastTickAgeMs` resets but no completion | Crash inside tick; pid recycling masks it |

## What NOT to do

- Do NOT `pg_terminate_backend` on a supervisor PID — use `pg_cancel_backend`.
- Do NOT delete rows from `pg_locks` directly.
- Do NOT disable `auditVerifyCron` or `sovereignLedgerVerifyCron`
  without an incident ticket.
- Do NOT bump retention down on `sessionReplayRetention` without legal sign-off.

## Related

- `.planning/RUNBOOK.md` (canonical kernel boot + smoke)
- `Docs/RUNBOOKS/incident-response.md`
- `Docs/RUNBOOKS/killswitch.md`
- `Docs/OPERATIONAL_SLA.md`
