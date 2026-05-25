# @borjie/forecasting-engine

Simulation + forecasting engine — the MD's imagination.

This package is the defining capability of AI-as-MD. Every mutate-tier action the central intelligence considers gets pushed through this engine first: build alternatives, run them in parallel against a sandboxed copy of the business, score the outcomes against the owner's intent, return a ranked recommendation + a DiffView for the owner. Low-risk + within-cap → execute autonomously. Higher-risk → ask the owner first.

## The closed loop

```
       ┌──────────────────────────────────────────────────────────────┐
       │                                                              │
       │  WorldModel ─► simulate(action) ─► RankedOutcomes ─► DiffView│
       │      ▲                                       │               │
       │      │                                       ▼               │
       │      │                                Execute (or ask owner) │
       │      │                                       │               │
       │      │                                       ▼               │
       │      │                              Real outcome arrives     │
       │      │                                       │               │
       │      │                                       ▼               │
       │      │                       computeDelta(prediction, actual)│
       │      │                                       │               │
       │      │                          ┌────────────┴────────────┐  │
       │      │                          ▼                         ▼  │
       │      │                  lessonFromDelta            proposeCurveUpdate
       │      │                          │                         │  │
       │      │                          ▼                         ▼  │
       │      │                   Reflexion buffer            World model curves
       │      │                                                       │
       │      └───────── world-model-update ─────────────────────────┘
       │                       (next prediction is sharper)
       └──────────────────────────────────────────────────────────────┘
```

Each cycle the engine learns: residual variance for time-series, posterior mass for Bayesian forecasters, drift for hand-coded causal curves. Lessons land in the Reflexion buffer; curve-update proposals land in a queue downstream learners consume.

## Architecture

| Layer | Purpose |
|---|---|
| `world-model/` | Persistent business-state representation. Tenant graph, cashflow state machine, compliance state machine, market cache, owner archetype profiles. |
| `sandbox/` | Sandbox runtime + Postgres schema-clone planner + TTL cleanup + isolation policy. No real-world side effects allowed. |
| `forecasters/time-series/` | Holt-Winters cashflow forecaster, Empirical-Bayes occupancy forecaster, logistic-growth arrears forecaster. All hand-implemented — no Python / SciPy / NumPy. |
| `forecasters/discrete-event/` | Lease-lifecycle simulator, M/M/c maintenance queue with vendor no-show. |
| `forecasters/causal/` | Retention curve (rent-change → P(retain)), pricing elasticity (ask-delta → P(signed in 30d)), with a generic causal-model registry. |
| `forecasters/stochastic/` | Per-tenant payment-timing log-normal renewal process, per-vendor Beta no-show posterior, Poisson per-class maintenance arrival process. |
| `scenarios/library/` | Six default scenarios: acquire-property, refinance, raise-rent, fire-vendor, water-main-crisis, lease-renewal-batch. Plus an NL → scenario keyword router for testing. |
| `scoring/` | Multi-objective outcome scoring + Pareto frontier when trade-offs are present. |
| `feedback/` | Predicted-vs-actual delta computation, lesson generation, curve-update proposals. |
| `orchestrator/` | `simulate()` top-level entry; parallel scenario runner; DiffView renderer for owner preview. |

## Key entry point

```ts
import { simulate } from '@borjie/forecasting-engine';

const result = await simulate({
  action: { kind: 'raise-rent', payload: { unitIds: [...], pctIncrease: 0.07, ... }, riskTier: 'mutate' },
  context: businessContext,
  options: { n: 3, seed: 42 },
});

result.ranked[0]; // best outcome
result.diffView;  // ready for plan-mode preview
result.paretoFront; // when trade-offs exist
```

## Sandbox modes

Two modes, selectable via `createSandbox({ mode })`:

- **`in-memory`** (default). Pure JavaScript map. Used in tests + the deterministic happy path. No side effects.
- **`schema-clone`**. Plans `CREATE SCHEMA sandbox_<runId>` against a real Postgres. The planner emits the SQL but does **not** execute it — execution is deferred to a downstream pg-client adapter that lives outside this package. This keeps the engine dependency-free and unit-testable.

Forbidden hosts (`api.stripe.com`, M-Pesa, KRA, Twilio, etc.) and forbidden write targets (`sovereign_action_ledger`, `audit_log`, etc.) are enforced at the sandbox boundary.

## Predicted-vs-actual feedback

When a real action's outcome lands, the call site computes the delta:

```ts
const delta = computeDelta(prediction, actualValue);
const lesson = lessonFromDelta(delta);     // → ReflexionLesson | null
const proposal = proposeCurveUpdate(...);  // → CurveUpdateProposal
```

Schema for the eventual `forecasting_predicted_actuals` table is referenced by `Prediction` + `PredictedActualDelta` in `src/types.ts`; the migration belongs to a follow-up wave that lives in `packages/database/`.

## Strict constraints

- Pure TypeScript. No Python, no SciPy, no NumPy. All forecasters are hand-implemented (Holt-Winters, Beta-Binomial, logistic regression by grid + local refinement, Poisson, Mulberry32 RNG).
- All public API surface is validated with zod where input crosses the boundary.
- Immutable everywhere — state machines return new instances; no mutation.

## Test surface

- `world-model.test.ts` — state updates, occupancy, immutability.
- `sandbox-runtime.test.ts` — in-memory + schema-clone planning + TTL cleanup + isolation.
- `forecasters/cashflow-forecaster.test.ts` — all 3 time-series forecasters: fit + forecast + update.
- `forecasters/retention-curve.test.ts` — both causal models with monotonicity proofs.
- `forecasters/payment-timing-process.test.ts` — all 3 stochastic processes + both discrete-event sims.
- `scenarios/raise-rent.test.ts` — 10-unit portfolio produces ranked outcomes.
- `scenarios/water-main-crisis.test.ts` — cascade impact + cash-shortfall risk.
- `scoring/outcome-scorer.test.ts` — deterministic ranking + Pareto frontier.
- `feedback/predicted-vs-actual.test.ts` — delta + lesson + curve-update proposal.
