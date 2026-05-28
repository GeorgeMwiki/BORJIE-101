# Closed-Loop Discipline

**Wave:** CLOSED-LOOP
**Author:** Mr. Mwikila (Borjie)
**Last updated:** 2026-05-29

Every action Mr. Mwikila proposes, or the owner takes, MUST:

1. Declare its **predicted outcome** at the moment of intent.
2. Be **reconciled** against the observed outcome after the prediction
   horizon elapses.
3. Feed the gap back into a **calibration score** so future predictions
   improve.

No dangling threads. No write-only data. The system measures itself.

## Three tables, one loop

Migration `0114_outcome_telemetry.sql` adds three RLS-FORCE tables:

| Table | Purpose | One row per |
|-------|---------|-------------|
| `outcome_predictions` | "WHAT I expect to change, by WHEN, with CONFIDENCE C" | WRITE action |
| `outcome_observations` | Observed reality after the horizon elapses | prediction |
| `outcome_reconciliations` | Gap analysis + learning signal | prediction |

All three are tenant-scoped via the canonical `app.tenant_id` GUC RLS
predicate. Predictions and reconciliations both carry an
`audit_hash_id` that extends `ai_audit_chain`, so a tamper of either
table breaks chain verification on the next walk.

## Worked example: switch fuel supplier

The owner asks: "Can we cut diesel cost?" Mr. Mwikila notices peer p25
fuel-per-tonne is 11L vs the owner's 14L, so he proposes switching to
Supplier X.

### Day 0: prediction

The brain calls `mining.fuel.switch_supplier(...)`. The wrapper at
`services/api-gateway/src/composition/brain-tools/outcome-predictor.ts`
intercepts BEFORE the underlying handler runs and inserts:

```jsonc
// outcome_predictions
{
  "tenant_id": "borjie_tenant_geita",
  "actor_kind": "brain",
  "actor_id": "user_mwikila",
  "action_kind": "mining.fuel.switch_supplier",
  "action_target_entity_type": "supplier",
  "action_target_entity_id": "sup_X",
  "predicted_outcome": {
    "monthly_diesel_litres_per_tonne": 11.2,
    "monthly_cost_tzs": 28_400_000
  },
  "prediction_confidence": 0.72,
  "prediction_horizon_days": 30,
  "predicted_value_tzs": 28_400_000,
  "rationale": "Peer p25 cohort runs at 11L/t; Supplier X already serves 4 peers in the cohort; switching cost is fully amortised by month 1",
  "audit_hash_id": "<ai_audit_chain.id>"
}
```

The wrapper ALSO appends to `ai_audit_chain` with action
`closed_loop.predict` carrying the same `predicted_outcome` envelope.
Mutating either row after-the-fact breaks hash-chain verification.

### Day 0..30: the action lands

The original tool handler runs unchanged. The wrapper is
observation-only on the success path. The owner clocks a fuel order
with Supplier X, the swap completes, life continues.

### Day 30: reconciliation worker ticks

The 6h cron at
`services/api-gateway/src/workers/outcome-reconciliation-worker.ts`
notices the prediction's horizon has elapsed and there is no
companion `outcome_reconciliations` row yet. It:

1. Calls the registered resolver for `entityType="supplier"`. The
   resolver reads the supplier's last 30d fuel logs and returns:

   ```jsonc
   {
     "observedOutcome": {
       "monthly_diesel_litres_per_tonne": 11.8,
       "monthly_cost_tzs": 29_900_000
     },
     "observedValueTzs": 29_900_000,
     "narrative": "Apr 1-30: 11.8 L/t avg, TZS 29.9M total"
   }
   ```

2. Inserts an `outcome_observations` row with `gap_pct =
   abs(29.9M - 28.4M) / 28.4M = 0.053` (~5.3%).

3. Computes the verdict:
   - Scalar drift: `0.053`
   - Classification: `matched` (drift < 0.15)
   - Learning signal:
     ```jsonc
     {
       "action_kind": "mining.fuel.switch_supplier",
       "actor_kind": "brain",
       "entity_type": "supplier",
       "status": "matched",
       "drift_score": 0.0529,
       "confidence": 0.72,
       "well_predicted_keys": ["monthly_cost_tzs", "monthly_diesel_litres_per_tonne"],
       "poorly_predicted_keys": [],
       "rationale_excerpt": "Peer p25 cohort runs at 11L/t..."
     }
     ```

4. Inserts the `outcome_reconciliations` row AND appends a
   `closed_loop.reconcile` entry to `ai_audit_chain`.

### Day 30: calibration score reflects the result

The owner asks Mr. Mwikila: "Did your last 5 recommendations work?"
The brain calls
`mining.calibration.score({sinceDays: 30})` (see
`services/api-gateway/src/services/calibration-monitor/brain-tool.ts`).

Tracker returns:

```jsonc
{
  "predictedCount": 5,
  "matchedCount": 4,
  "divergentCount": 1,
  "undeterminedCount": 0,
  "expiredCount": 0,
  "accuracy": 0.8,
  "meanDrift": 0.12,
  "calibrationCurve": [
    {"confidenceLower": 0.0, "confidenceUpper": 0.2, "count": 0, "matchedFraction": 0},
    {"confidenceLower": 0.2, "confidenceUpper": 0.4, "count": 0, "matchedFraction": 0},
    {"confidenceLower": 0.4, "confidenceUpper": 0.6, "count": 1, "matchedFraction": 0},
    {"confidenceLower": 0.6, "confidenceUpper": 0.8, "count": 2, "matchedFraction": 1},
    {"confidenceLower": 0.8, "confidenceUpper": 1.0, "count": 2, "matchedFraction": 1}
  ]
}
```

Mr. Mwikila answers: "4 of 5 landed close to forecast (the fuel
switch hit within 5%, the licence renewal landed early, the royalty
draft was off by 7% on the mineral mix). One missed: the cooperative
settlement took 21 days, not 14. Accuracy is 80% this month."

### Alerter kicks in below 0.6

If accuracy drops below 0.6 on a sample of >=5 verdicts, the alerter
at `services/api-gateway/src/services/calibration-monitor/alerter.ts`
emits a `calibration_drift` event. The brain surfaces a humble line in
the next reply ("My predictions have been less accurate this week,
let me ask you for more context before recommending") per the
CLOSED-LOOP DISCIPLINE section in
`services/api-gateway/src/routes/public-chat.hono.ts`.

## Honesty about uncertainty

The wrapper NEVER fabricates predictions. When the predictor cannot
ground a forecast, it records:

```jsonc
{
  "predicted_outcome": {"unmodeled": true},
  "prediction_confidence": 0.000,
  "prediction_horizon_days": 30,
  "rationale": ""
}
```

The reconciliation worker skips `confidence === 0` rows entirely (the
claim query has `WHERE p.prediction_confidence > 0`), so unmodeled
rows are audited but excluded from the calibration score. False
precision is worse than honest silence.

## When the entity has no resolver

Some entity types (e.g. brand-new mining-cooperative payouts) don't
have a registered resolver yet. The worker closes the loop anyway by
inserting a reconciliation with `status='expired'` and a
`learning_signal` naming the missing resolver. Operators see expired
rows in the cockpit and know to wire the resolver. The chain stays
clean.

## End-to-end invariants

| Invariant | Enforced by |
|-----------|-------------|
| Every WRITE tool earns a prediction row | `wrapWritesWithOutcomePrediction()` applied to every handler whose descriptor declares `isWrite: true` |
| Every prediction is hash-chained | `appendPredictionAudit()` writes `closed_loop.predict` to `ai_audit_chain` |
| Every reconciliation is hash-chained | `appendReconciliationAudit()` writes `closed_loop.reconcile` |
| Predictions are immutable | RLS FORCE + append-only; no UPDATE statements in the worker or wrapper |
| Tenants cannot cross-read | RLS FORCE on all three tables with `app.tenant_id` GUC |
| Honesty floor | confidence-0 rows are recorded but excluded from drift scoring |

## File map

| Layer | Path |
|-------|------|
| Migration | `packages/database/src/migrations/0114_outcome_telemetry.sql` |
| Drizzle schema | `packages/database/src/schemas/outcome-telemetry.schema.ts` |
| Worker (6h tick) | `services/api-gateway/src/workers/outcome-reconciliation-worker.ts` |
| Wrapper (per WRITE) | `services/api-gateway/src/composition/brain-tools/outcome-predictor.ts` |
| Tracker | `services/api-gateway/src/services/calibration-monitor/tracker.ts` |
| Alerter | `services/api-gateway/src/services/calibration-monitor/alerter.ts` |
| Brain tool | `services/api-gateway/src/services/calibration-monitor/brain-tool.ts` |
| Brain prompt extension | `services/api-gateway/src/routes/public-chat.hono.ts` (CLOSED-LOOP DISCIPLINE section, EN + SW) |
| Worker test | `services/api-gateway/src/workers/__tests__/outcome-reconciliation-worker.test.ts` |
| Tracker test | `services/api-gateway/src/services/calibration-monitor/__tests__/tracker.test.ts` |
