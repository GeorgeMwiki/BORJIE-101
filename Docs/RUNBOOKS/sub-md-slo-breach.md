# Runbook: SubMdSloBreach

| Field | Value |
|---|---|
| Alert | `SubMdSloBreach` |
| Severity | critical |
| Page | central-command on-call |

## What this means

A sub-MD (sub-model-deployment) is reporting `slo_status="breach"` for ≥5 min.

## First 5 minutes

1. Open `Sub-MD SLOs` Grafana dashboard.
2. Identify the affected sub-MD and its current canary stage.
3. Check breach-count timeline — is this a fresh breach or one that's been
   marginal for hours?
4. Look at the SLI dropping (latency? error rate? trajectory score?).

## Decision tree

- **Canary stage 1 or 2**: Pause the canary; auto-rollback is the default.
- **Canary stage 3+**: Significant traffic. Decide between rollback (default)
  vs targeted mitigation if root cause is known and quick to patch.
- **Production stage**: SEV-1 — open war-room.

## Mitigations

- Roll back via canary controller
- Tighten admission to higher-trust tenants only
- Reduce sub-MD blast radius via tenant filter

## Escalation

- Stage-3+ breach unmitigated 30 min → page central-command lead + product
- Production breach → SEV-1
