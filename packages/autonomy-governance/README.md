# @borjie/autonomy-governance

**Per-tenant autonomy caps + per-sub-MD quality SLOs + auto-rollback. The Klarna defense substrate.**

In May 2025, Klarna walked back its "700 agents replaced" headline. The textbook failure: they optimised for deflection rate, missed quality drift, scaled fast, regretted faster.

This package is the architectural defense recommended by our R1 + R3 research:

1. **Per-tenant autonomy cap** — a daily envelope on autonomous mutations + cost, plus per-tool-tier and per-sub-MD sub-envelopes. The kernel must consult `evaluateAutonomyCap` before any mutate-tier action.
2. **Per-sub-MD quality SLO** — every sub-MD ships with at least one SLO. Recent outcomes stream into `evaluateSlo`; sustained breaches fire one of four breach actions.
3. **Canary stage ladder** — `shadow → 1% → 5% → 25% → live`. Promotion is human-driven. Demotion is automatic on breach.
4. **Auto-rollback engine** — converts SLO verdicts into canary updates, handoff-queue inserts, and (in the kill-and-rollback case) sub-MD reverts.
5. **Handoff-to-human queue** — quarantined work routes here so nothing is dropped on the floor.

## Framing

Sub-MDs are **scoped, reversible task-contracts**, not autonomous juniors. Every contract carries:

- A cap. The cap defines the maximum daily blast radius.
- An SLO. The SLO defines the quality floor at which the contract still holds.
- A canary stage. The stage defines who actually sees the sub-MD's output today.
- A breach action. The action defines what happens when the SLO trips.

## Public API

```ts
import {
  evaluateAutonomyCap,
  evaluateSlo,
  executeAutoRollback,
  defaultCap,
  parseSubMdSlo,
  demoteStage,
} from '@borjie/autonomy-governance';
```

See `src/index.ts` for the full surface.

## Wiring

This package is wire-agnostic. The kernel-side hook that calls
`evaluateAutonomyCap` before every mutate-tier action is a follow-up
(Phase E.5). Ports defined here:

- `TenantAutonomyCapStore` / `AutonomyRollingStateStore` — backed by `tenant_autonomy_caps` + the sovereign-action-ledger.
- `CanaryStageStore` — backed by `sub_md_slos.canary_stage`.
- `HandoffQueuePort` / `HandoffQueueReader` — backed by `exception_inbox`.
- `SubMdRevertPort` — backed by the kernel's prompt-registry / persona-registry restore APIs.

## Schemas

Database side lives in:

- `packages/database/src/schemas/autonomy-caps.schema.ts` — `tenant_autonomy_caps`
- `packages/database/src/schemas/sub-md-slo.schema.ts` — `sub_md_slos` + `sub_md_slo_events`
- Migration `packages/database/src/migrations/0160_autonomy_governance.sql`

## Tests

```
pnpm --filter @borjie/autonomy-governance test
```

Coverage: cap-evaluator (every verdict branch), SLO monitor (sample size, tolerance band, all four breach actions), auto-rollback engine (every action branch with fake ports), canary controller (ladder + sticky hashing + traffic-share statistical check).
