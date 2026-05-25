# Long-horizon Agent Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/long-horizon-agent/`
**Public entry:** `packages/long-horizon-agent/src/index.ts`
**Tier scope:** all (every mission is tenant-scoped via RLS)

## Purpose

Piece Q — the multi-day / multi-week agency loop. The brain decomposes a
high-level owner / persona goal ("find a lessee for Plot 27B by Nov 30",
"complete the Q3 condition survey across Tabora", "negotiate the 12
lease renewals expiring in November") into an ordered plan, dispatches
today's steps each day, reviews progress at daily / weekly / milestone
checkpoints, replans when drift is detected (under autonomy-tier-aware
HITL gating), writes a structured outcome on completion, and feeds the
lessons back into the Reflexion buffer for the next mission's planning.

This package replaces the implicit, session-bound agency model with an
explicit one whose state lives in `agency_missions`, `mission_steps`,
`mission_checkpoints`, `mission_outcomes`, and `mission_drift_log`
(migrations 0266-0270).

## Entry points

- `src/mission-planner.ts` — `planMission(input, deps)` decomposes a
  goal into mission_steps via the kernel ToT / LATS plan-decomposer
  port and persists the mission + steps via the repository port.
- `src/step-dispatcher.ts` — `dispatchMission({tenantId, missionId},
  deps)` picks today's pending steps, gates them through the autonomy
  tier (`needsApproval` helper), runs them via the action_runtime port
  (Piece E), records results, and rolls the mission up to
  `completed | escalated` once every step is terminal.
- `src/checkpoint-runner.ts` — `runDueCheckpoints({tenantId}, deps)`
  sweeps every pending checkpoint whose `scheduled_at <= now`,
  computes gaps + drift signals, asks the narrator port for a
  human-readable summary, persists the result, and writes a progress
  brief for the assigning persona on weekly checkpoints.
- `src/drift-detector.ts` — `detectDrift({mission, steps, nowIso})`
  emits `DriftSignal[]` (deadline_slip / budget_overrun / step_replan
  / external_blocker). Pure; deterministic.
- `src/replan-engine.ts` — `handleDrift({tenantId, missionId, signal},
  deps)` either auto-applies a deterministic recipe
  (`composeRecipe`) when the autonomy tier permits (`canAutoApply`)
  or parks the drift for HITL review. Every mutation appends a
  `mission_drift_log` row.
- `src/outcome-writer.ts` — `finaliseOutcome({tenantId, missionId,
  outcomeKind}, deps)` reads the final state, computes metrics +
  lessons, writes a `mission_outcomes` row, and feeds lessons into
  the Reflexion buffer.
- `src/cron.ts` — `runDailyAgencyCycle({tenantId}, deps)` is the daily
  entry point the cron orchestrator calls per tenant; runs
  checkpoints → drift handling → step dispatch → outcome finalisation
  in a single bounded pass.
- `src/types.ts` — Zod schemas + inferred TS types for every
  row + planner input + dispatch result.

## Internal structure

- `src/index.ts` — barrel re-exporting every public function + type.
- `src/mission-planner.ts` — planning + step normalisation.
- `src/step-dispatcher.ts` — autonomy-aware dispatch loop.
- `src/drift-detector.ts` — pure drift signal computation.
- `src/checkpoint-runner.ts` — checkpoint sweep + gap computation +
  HITL flagging.
- `src/replan-engine.ts` — replan recipes + autonomy gating.
- `src/outcome-writer.ts` — metrics, lessons, Reflexion feed.
- `src/cron.ts` — orchestrator combining all of the above.
- `src/types.ts` — single source of Zod truth.
- `src/__tests__/` — full unit coverage (94%+ lines, 87%+ branches)
  using in-memory adapter stubs.

## Migrations (0266-0270)

- `0266_agency_missions.sql` — mission header (risk_tier,
  autonomy_tier, budget_minor_units, asset_refs, audit_chain_id).
- `0267_mission_steps.sql` — ordered atomic steps (step_kind ∈
  plan/gather/execute/check/reflect), soft pointer to action_plans
  (Piece E).
- `0268_mission_checkpoints.sql` — daily / weekly / milestone review
  points (summary, gaps_jsonb, drift_signals_jsonb,
  needs_human_review).
- `0269_mission_outcomes.sql` — terminal record (outcome_kind,
  narrative, metrics_jsonb, lessons_learned_jsonb) — UNIQUE on
  mission_id so outcome finalisation is idempotent.
- `0270_mission_drift_log.sql` — append-only-spirit log of replan /
  drift events with before / after snapshots + HITL approval
  metadata.

Every table uses the gold-standard RLS pattern matching 0182-0185:
ENABLE + FORCE ROW LEVEL SECURITY, tenant_isolation_select +
tenant_isolation_modify policies via `public.current_app_tenant_id()`,
REVOKE ALL FROM anon.

## Dependencies

- Upstream callers: api-gateway composition root (wires real
  adapters), cron orchestrator (one call per tenant per day).
- Downstream ports (all injected, no hard package deps):
  - `MissionPlannerPort` — wraps `decomposePlan` from
    `packages/central-intelligence/src/kernel/agency/goals/`.
  - `ActionRuntimePort` — Piece E's action runtime.
  - `HitlGatewayPort` — autonomy-governance + approval inbox.
  - `OutcomeNarratorPort`, `CheckpointSummariserPort` — kernel
    narrator (production) / pure stub (tests).
  - `ProgressBriefWriterPort` — persona registry digest writer.
  - `ReflexionFeedPort` — mirrors `ReflexionRecorderPort` from
    `packages/central-intelligence/src/kernel/reflexion/` so the
    composition root can pass the real adapter directly.
  - Repository ports — all backed by `packages/database` adapters
    that bind the `app.current_tenant_id` GUC before every query.

## Autonomy tier matrix

| `autonomy_tier` | Dispatch HITL on... | Replan auto-apply |
|---|---|---|
| `HITL_HIGH` | every step | never |
| `HITL_MEDIUM` | execute + check | never |
| `HITL_LOW` | execute on HIGH/SOVEREIGN risk only | step_replan only |
| `AUTONOMOUS` | SOVEREIGN risk only | step_replan + deadline_slip + external_blocker (LOW risk only) |

`goal_shift` and `budget_overrun` are NEVER auto-applied; the assigner
must intervene.

## Common workflows

- **Owner asks the brain to find a lessee** → api-gateway routes the
  request to `planMission()`. The kernel decomposes the goal. The
  mission rows land in `agency_missions` + `mission_steps`. The cron
  picks the mission up the next day.
- **Daily dispatch** → cron calls `runDailyAgencyCycle()` once per
  tenant. The cycle runs due checkpoints first (so drift discovered
  yesterday gates today's dispatch), then handles fresh drift
  signals via the replan engine, then dispatches today's pending
  steps, then finalises outcomes for any missions that just
  completed.
- **Drift detected** → `detectDrift()` runs at every checkpoint. The
  signals land on the checkpoint row. The replan engine inspects the
  mission's autonomy_tier and either auto-applies the recipe (writing
  `mission_drift_log` + `mission_steps` mutations) or parks the
  drift event for HITL review.
- **Mission completes** → step dispatcher transitions the mission to
  `completed` (or `escalated` on any failed step). The cron calls
  `finaliseOutcome()` which writes the outcome row + lessons; the
  Reflexion feed records each lesson against
  `taskId = "mission:<id>"`.

## Anti-patterns to avoid

- Never write directly to `mission_steps.status` from outside this
  package. The dispatcher is the only authorised mutator.
- Never bypass `canAutoApply()` even for AUTONOMOUS missions —
  `goal_shift` and SOVEREIGN-tier missions must hit HITL.
- Never block on the Reflexion feed; outcome writes succeed even if
  the buffer is unavailable (try/catch around the per-lesson call).
- Never use `INSERT … ON CONFLICT DO UPDATE` on `mission_outcomes`
  — the UNIQUE constraint makes finalisation idempotent; second
  call must be a no-op.
- Never set `mission_drift_log.detected_by = 'human'` from the
  cron path. That value is reserved for direct user edits in the
  api-gateway.

## Related codemaps

- [central-intelligence.md](./central-intelligence.md) — kernel
  plan-decomposer + Reflexion buffer
- [autonomy-governance.md](./autonomy-governance.md) — HITL gating
  + approval inbox
- [database.md](./database.md) — migration list + RLS pattern
- [agent-platform.md](./agent-platform.md) — agent-to-agent auth +
  audit chain (`ai_audit_chain` soft-pointed from
  `agency_missions.audit_chain_id`)
