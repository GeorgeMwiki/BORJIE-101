# Runbook: BreachIndicator

| Field | Value |
|---|---|
| Alert | `BreachIndicator` |
| Severity | critical |
| Page | security |

## What this means

Either >5 unauthorised audit events OR >10 PII egress blocks in a 5-minute
window. This is a **potential personal-data breach** indicator.

## Compliance clock

**START the 72-hour breach notification clock the moment this alert fires.**
You can stop the clock later if the incident is confirmed NOT a breach, but
you cannot retroactively roll back time once you fail to notify.

See [`docs/compliance/breach-notification-runbook.md`](../compliance/breach-notification-runbook.md).

## First 5 minutes

1. Acknowledge page within 5 min
2. Open `MD Orchestrator — Overview` + audit panel
3. Tail `audit_events` table — what scope (`audit:unauthorised:*`) is the
   actor hitting? Single actor or distributed?
4. Snapshot evidence — write-protect logs, preserve traces

## Decision tree

- **Single misconfigured client / role**: not a breach. Close ticket.
  Document decision in sovereign-action-ledger.
- **Distributed exploitation attempt**: declare SEV-1, war-room.
- **Confirmed exfiltration**: follow breach-notification-runbook —
  jurisdiction-specific 72h notifications.

## Containment actions

- Revoke implicated tokens
- Disable affected accounts
- Block IPs at WAF (if external)
- Rotate any credentials in the blast radius

## Escalation

- ALWAYS page DPO in parallel — they need to start drafting notifications
- Coordinate with legal counsel for regulator-facing language
- CEO + Comms loop for SEV-1
