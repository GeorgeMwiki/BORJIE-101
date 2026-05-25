# Runbook: KernelErrorRateHigh

| Field | Value |
|---|---|
| Alert | `KernelErrorRateHigh` |
| Severity | critical |
| Page | central-command on-call |
| Source | `infra/observability/alerts/md-orchestrator.rules.yml` |

## What this means

`rate(kernel_errors_total[5m]) > 0.01` sustained for ≥10 min. The kernel is
returning errors at over 1% of total request rate — that's beyond the SLO.

## First 5 minutes

1. Open the `MD Orchestrator — Overview` Grafana dashboard.
2. Identify which sub-MD is dominating the error rate (panel: "Error rate").
3. Tail-sample 10 error traces via OTel (Tempo / Honeycomb): filter
   `error=true status_code>=500`.
4. Check the deploy timeline — did anything ship in the last hour?

## Likely root causes

- Recent kernel deploy with hook-chain regression
- Sub-MD canary stage 3+ failing on real traffic
- Downstream dependency outage (DB, Redis, model provider)
- A specific tenant triggering a code path on an edge case

## Mitigations

- If recent deploy is implicated: roll back via `kubectl rollout undo` or
  toggle the feature flag.
- If a single tenant is dominating: temporarily lower their cap.
- If a sub-MD is dominating: throttle it via the canary stage controller.

## Escalation

- 15 min unmitigated → page central-command lead
- 30 min unmitigated → declare SEV-2 incident
- Detected as PII-touching → cross-reference
  [breach-notification-runbook](../compliance/breach-notification-runbook.md)
