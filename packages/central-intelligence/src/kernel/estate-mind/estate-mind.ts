/**
 * `EstateMind` — the resident per-tenant Slow Loop (Wave 1, organ #1).
 *
 * ONE TICK, per tenant, runs the structured cognitive cycle:
 *
 *   PERCEIVE  — pull observations from the perception source and FOLD them into
 *               the situational model (recency×frequency series preserved).
 *   ORIENT    — compute the activated snapshot (salience as a computed field);
 *               the most-salient entity is the Global-Workspace broadcast.
 *   MOTIVATE  — evaluate the standing drives over the snapshot; each UNSATISFIED
 *               drive yields a self-formulated goal (no incoming trigger).
 *   PROPOSE   — surface each goal as a PROPOSAL through the gated proposal sink
 *               (the existing proactive path). The loop NEVER executes a
 *               sovereign/money/licence action — those stay HITL.
 *   FORGET    — optionally prune cold entities (opt-in; a memory-growth SAFETY
 *               bound, never a capability cap).
 *
 * The situational model IS the state held between ticks — the loop is durable
 * in the sense that its memory lives in the (blackboard/Drizzle) store, so a
 * restart resumes from the last persisted situational state.
 *
 * IDEMPOTENT + NEVER-THROWS: every external boundary (perceive, sink, prune) is
 * wrapped; a failure degrades the tick (recorded in `degradedReason`) but never
 * throws to the heartbeat supervisor. Re-running a tick with the same inputs
 * coalesces proposals by their stable drive-keyed id (the sink dedupes), so a
 * double-fire is harmless.
 */

import type {
  EstateMindCycleResult,
  EstateMindDeps,
  EstateMindTickResult,
  EstateProposal,
  ReconcileResult,
} from './types.js';
import type { MotivatedGoal } from '../motivation/types.js';

const DEFAULT_PRUNE_IDLE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NOOP_LOGGER = { info(): void {}, warn(): void {} };

export interface EstateMind {
  /** Run ONE cognitive cycle for a single tenant. Never throws. */
  tick(tenantId: string): Promise<EstateMindTickResult>;
  /** Run a heartbeat across many tenants; isolates per-tenant failures. */
  cycle(tenantIds: ReadonlyArray<string>): Promise<EstateMindCycleResult>;
}

export function createEstateMind(deps: EstateMindDeps): EstateMind {
  const now = deps.now ?? (() => Date.now());
  const pruneIdleMs = deps.pruneIdleMs ?? DEFAULT_PRUNE_IDLE_MS;
  const logger = deps.logger ?? NOOP_LOGGER;
  const { situationalModel, motivation } = deps;

  async function tick(tenantId: string): Promise<EstateMindTickResult> {
    const nowMs = now();
    let degradedReason: string | null = null;
    let observed = 0;

    // ── PERCEIVE — fold fresh observations into the situational model ──────
    if (deps.perception) {
      try {
        const obs = await deps.perception.perceive({ tenantId, nowMs });
        for (const o of obs) {
          try {
            await situationalModel.observe(o);
            observed += 1;
          } catch (err) {
            // One bad observation never aborts the whole PERCEIVE step.
            degradedReason = 'observe-failed';
            logger.warn('estate-mind: observe failed', {
              tenantId,
              entityId: o.entityId,
              error: errMsg(err),
            });
          }
        }
      } catch (err) {
        degradedReason = 'perceive-failed';
        logger.warn('estate-mind: perceive failed', {
          tenantId,
          error: errMsg(err),
        });
      }
    }

    // ── ORIENT — compute the activated snapshot (salience as computed field)
    const snapshot = await situationalModel.snapshot(tenantId);

    // ── RECONCILE — the DEFERRAL / FOLLOW-THROUGH sweep (never-drop-a-thread).
    // Re-read the WHOLE durable commitment backlog, recompute due/overdue/
    // blocked, resurface through the SAME gated proposal sink, advance the
    // ladder, escalate overdue SOVEREIGN obligations to the HITL safe-halt
    // (never auto-actuate), and close only on positive proof (else re-open).
    // FAIL-SAFE: a reconcile fault degrades the tick, never breaks it.
    let reconcile: ReconcileResult | null = null;
    if (deps.reconciliation) {
      try {
        reconcile = await deps.reconciliation.reconcile({ tenantId, nowMs });
        if (reconcile.degradedReason && !degradedReason) {
          degradedReason = `reconcile:${reconcile.degradedReason}`;
        }
      } catch (err) {
        // The port contract says reconcile never throws; belt-and-braces guard
        // the boundary so a pathological implementation can never break the tick.
        degradedReason = degradedReason ?? 'reconcile-failed';
        logger.warn('estate-mind: reconcile failed', {
          tenantId,
          error: errMsg(err),
        });
      }
    }

    // ── MOTIVATE — standing drives → self-formulated goals (no trigger) ────
    const goals = motivation.formulateGoals(snapshot);

    // ── PROPOSE — surface each goal through the gated proposal sink ────────
    let proposalsEmitted = 0;
    if (deps.proposalSink && goals.length > 0) {
      for (const goal of goals) {
        const proposal = toProposal(goal, nowMs);
        try {
          const accepted = await deps.proposalSink.propose(proposal);
          if (accepted) proposalsEmitted += 1;
        } catch (err) {
          degradedReason = degradedReason ?? 'propose-failed';
          logger.warn('estate-mind: propose failed', {
            tenantId,
            proposalId: proposal.id,
            error: errMsg(err),
          });
        }
      }
    }

    // ── FORGET — opt-in pruning of cold entities (SAFETY bound) ────────────
    let pruned = 0;
    try {
      const removed = await situationalModel.prune(tenantId, pruneIdleMs);
      pruned = removed.length;
    } catch (err) {
      // Pruning is best-effort; a failure never degrades the cognitive cycle.
      logger.warn('estate-mind: prune failed', {
        tenantId,
        error: errMsg(err),
      });
    }

    return {
      tenantId,
      observed,
      snapshot,
      goalsFormulated: goals.length,
      proposalsEmitted,
      pruned,
      reconcile,
      degradedReason,
    };
  }

  async function cycle(
    tenantIds: ReadonlyArray<string>,
  ): Promise<EstateMindCycleResult> {
    const perTenant: EstateMindTickResult[] = [];
    let proposalsEmitted = 0;
    for (const tenantId of tenantIds) {
      if (!tenantId) continue;
      // tick never throws, but belt-and-braces guard the loop boundary so one
      // tenant's pathological state can never stall the whole heartbeat.
      try {
        const result = await tick(tenantId);
        perTenant.push(result);
        proposalsEmitted += result.proposalsEmitted;
      } catch (err) {
        logger.warn('estate-mind: tick threw (isolated)', {
          tenantId,
          error: errMsg(err),
        });
      }
    }
    if (perTenant.length > 0) {
      logger.info('estate-mind: cycle complete', {
        tenants: perTenant.length,
        proposalsEmitted,
      });
    }
    return Object.freeze({
      tenants: perTenant.length,
      proposalsEmitted,
      perTenant: Object.freeze(perTenant),
    });
  }

  return { tick, cycle };
}

function toProposal(goal: MotivatedGoal, nowMs: number): EstateProposal {
  return Object.freeze({
    tenantId: goal.tenantId,
    id: goal.id,
    driveId: goal.driveId,
    title: goal.title,
    rationale: goal.rationale,
    urgency: goal.urgency,
    breachSeverity: goal.breachSeverity,
    evidenceEntityIds: Object.freeze(
      goal.evidence.map((e) => e.entity.entityId),
    ),
    proposedAtMs: nowMs,
  });
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
