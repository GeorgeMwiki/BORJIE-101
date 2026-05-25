# Runbook: AutonomyCapBreached

| Field | Value |
|---|---|
| Alert | `AutonomyCapBreached` |
| Severity | critical |
| Page | central-command on-call |

## What this means

A tenant has exceeded their autonomy cap. The kernel SHOULD be shedding their
traffic. If this alert fires it means either:
- Pre-breach throttling failed (a bug in the kernel cap enforcer), OR
- The cap was recently lowered while usage was already above it.

## First 5 minutes

1. Confirm in `Autonomy Cap Usage` dashboard — is shedding actually happening?
   Look for `kernel_throttled_requests_total{tenant_id="..."}` non-zero.
2. If shedding is on: alert is informational. Tenant gets 429s; warning UI
   shows. Coordinate with customer success.
3. If shedding is OFF: this is a kernel bug. Page central-command lead
   immediately.

## Mitigations

- Manually force shedding via `POST /admin/tenants/:id/shed=true`
- Roll back any recent kernel cap-enforcer changes
- Bump cap (rare — only if tenant is enterprise + signed off)

## Escalation

- Kernel-bug version → SEV-2, central-command lead + eng lead
- Routine over-budget → no escalation, customer success follow-up
