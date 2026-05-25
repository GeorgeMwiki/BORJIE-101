# Runbook: ForecastingAccuracyDegrade

| Field | Value |
|---|---|
| Alert | `ForecastingAccuracyDegrade` |
| Severity | warning |
| Page | ml-platform |

## What this means

The forecasting engine's accuracy score has averaged <0.7 over the last
hour for ≥30 min. This indicates model drift.

## First 5 minutes

1. Open `Forecasting Accuracy` dashboard
2. Identify which scenario(s) are degrading — single scenario or all?
3. Pull recent predicted-vs-actual deltas — is the error directional
   (consistently over or under) or symmetric?

## Likely root causes

- Seasonality shift (e.g., Ramadan / Christmas / harvest cycles)
- Data-pipeline error (stale features)
- Concept drift (real-world distribution changed)
- Recent model deploy regressed accuracy

## Mitigations

- Roll back to previous model version
- Trigger emergency retrain on fresh data
- Disable downstream auto-decisions that depend on the affected forecast

## Escalation

- Accuracy < 0.5 → SEV-3 → ml-platform lead
- Affects automated tenant decisions → notify DPO (Art. 22 implications)
