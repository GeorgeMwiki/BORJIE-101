# Killswitch Operator Runbook

> Audience: on-call SRE, platform admin, or duty-incident commander.
> Severity: this runbook governs the single most blast-radius-broad
> control in Borjie. Do not skim. Every flip is logged.

## When to flip the killswitch

| Symptom | Recommended level |
|---|---|
| Audit-chain verification cron alerts (tamper suspected) | `paused` (writes blocked) then escalate |
| LLM provider mass outage causing degraded customer flows | `read-only` (kernel sees, never writes) |
| Active credential exfiltration / compromised tenant key | `locked` (full freeze, root recovery only) |
| Planned maintenance window > 5 min | `read-only` |
| Soft-rollback after a bad deploy | `off` after fix verified |

## Blast-radius matrix

| Level | API gateway | Kernel | Outbox | Webhooks | Cron supervisors | Customer-facing portals |
|---|---|---|---|---|---|---|
| `off` (normal) | full | full | drains | dispatches | run | live |
| `read-only` | GET only | sense+plan, no actuate | drains | dispatches | sense-only ticks | read-only banner |
| `paused` | 503 on writes | rejects every turn | halt | halt | skip ticks | "Maintenance" banner |
| `locked` | full reject (503) | reject + alarm | halt | halt | halt | hard-503 |

> The kernel reads the killswitch on every turn at step 1
> (inviolable gate). A flip propagates within one tick of the
> cross-portal event bus (≤ 5s typical).

## How to flip — primary path (HQ tool)

The supported flip path is the HQ tool `platform.set_killswitch`,
exposed inside the admin Central Command (`apps/admin-platform-portal/`).
Operators with `SUPER_ADMIN` role chat the brain:

```
> Set platform killswitch to read-only. Reason: provider outage; rollback in 30 min.
```

The brain four-eye-approves the call (it is `tier=sovereign`, requires
a second admin signature). The signed approval persists to
`sovereign_approvals` with the operator identity, timestamp, reason
string, and resulting level.

Programmatic equivalent (CI / scripts):

```bash
curl -X POST "$API_BASE_URL/api/v1/platform/killswitch" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "read-only",
    "reason": "Anthropic provider outage — rollback expected 19:30 UTC",
    "approvalToken": "<second-admin-signed-token>"
  }'
```

## How to flip — emergency fallback (SQL)

Only when the API gateway is itself wedged. Direct DB write:

```sql
UPDATE platform_killswitch_state
   SET level = 'paused',
       reason = 'EMERGENCY: gateway 5xx storm — see incident #2026-05-18-01',
       updated_at = NOW(),
       updated_by = 'sre-oncall:<your-email>'
 WHERE singleton_id = 'global';
```

The cross-portal bus polls this row every 2s and fans out the change.
Always pair an emergency SQL flip with:

1. A post-incident audit row inserted into `sovereign_action_ledger`
   with `actor='sre-oncall'`, `tier='sovereign'`, `mode='break-glass'`.
2. A note in the on-call channel + a paper trail in the incident tracker.

## Recovery — flipping back to `off`

1. Verify the root cause is mitigated (provider 200s, deploy rolled back,
   credential rotated). Use the standard health probes:
   ```bash
   curl -fsS "$API_BASE_URL/healthz" && curl -fsS "$API_BASE_URL/readyz"
   ```
2. Flip via HQ tool exactly as above, level `off`, with a recovery reason.
3. Confirm the change propagated:
   ```sql
   SELECT level, reason, updated_at, updated_by
     FROM platform_killswitch_state WHERE singleton_id='global';
   ```
4. Tail the kernel boot logs for `[killswitch] level=off — kernel resumed`.
5. Burn down the customer-facing maintenance banner via the same
   Central Command surface.

## Cross-portal fan-out behaviour

A single flip fans out across:

- **api-gateway** — middleware rejects writes (or all requests at `locked`)
- **kernel** — `four-eye-approval.ts` + `policy-gate.ts` short-circuit
- **outbox worker** — drainer pauses; events accumulate until resume
- **cron supervisors** — every supervisor consults the level before tick
- **webhook dispatcher** — outbound deliveries halt; replay queue grows
- **session-replay chunker** — keeps capturing (forensic value), no upload

Backlog drainage on resume is automatic but **rate-limited** so a
sudden flood doesn't hammer downstream providers. Expect ~5-10 min for
1-hour backlogs to fully drain.

## Audit-trail evidence pathway

Every flip writes three rows:

1. `platform_killswitch_audit` (the level transition itself)
2. `sovereign_action_ledger` (with four-eye approval row hash)
3. `kernel_action_audit` (the brain's view of the transition)

To produce auditor-facing evidence:

```bash
pnpm -C scripts ts-node export-killswitch-audit.ts \
  --from "2026-04-01" --to "2026-05-01" --out audit-bundle.json
```

(Script ships in wave-M; until then, dump the three tables via
`pg_dump --data-only --table 'platform_killswitch_*' --table 'sovereign_action_ledger'`.)

## 3 AM rapid-response decision tree

```
ALERT FIRES at 03:00
  │
  ├── Is the incident a confirmed tamper / breach?
  │       YES → flip to `locked` immediately; page security lead.
  │       NO  → continue.
  │
  ├── Are customers seeing 5xx?
  │       YES → flip to `paused` if writes-only failure,
  │             `locked` if reads also failing.
  │       NO  → continue.
  │
  ├── Is the failure scoped to AI providers only?
  │       YES → flip to `read-only`; customer flows that don't
  │             need the brain stay live.
  │       NO  → continue.
  │
  └── Unknown root cause but degradation visible?
          → flip to `read-only` (safe default), buy 15 min,
            triage, then escalate or recover.
```

Never flip to `off` blindly during an active incident. Always
verify the underlying issue is resolved first.

## What NOT to do

- Do NOT flip via direct SQL when the gateway is healthy. Use the
  HQ tool so the four-eye approval row is generated.
- Do NOT skip the `reason` field. Auditors will reject the evidence.
- Do NOT modify `platform_killswitch_state` rows other than the
  `global` singleton.
- Do NOT delete rows from `platform_killswitch_audit`. Append-only.

## Related

- `Docs/RUNBOOKS/incident-response.md` — escalation chain + paging
- `Docs/RUNBOOKS/four-eye-approval-review.md` — approval flow internals
- `Docs/RUNBOOKS/audit-chain-verification.md` — what kicks off a `paused` flip
- `packages/central-intelligence/src/kernel/killswitch.ts` — kernel reader
