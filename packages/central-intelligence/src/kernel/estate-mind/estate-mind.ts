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
  GapWatchSummary,
  ReconcileResult,
} from './types.js';
import type { DriveThresholds, MotivatedGoal } from '../motivation/types.js';

const DEFAULT_PRUNE_IDLE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NOOP_LOGGER = { info(): void {}, warn(): void {} };

export interface EstateMind {
  /** Run ONE cognitive cycle for a single tenant. Never throws. */
  tick(tenantId: string): Promise<EstateMindTickResult>;
  /** Run a heartbeat across many tenants; isolates per-tenant failures. */
  cycle(tenantIds: ReadonlyArray<string>): Promise<EstateMindCycleResult>;
  /**
   * Read the most-recent OPEN proposals the slow loop has surfaced for a
   * tenant, newest first. This is the seam that closes the loop between
   * the slow cognitive cycle (PROPOSE → proactive_nudge rows) and the
   * conversational fast loop: the kernel calls this mid-turn (step 5c)
   * so the MD is AWARE of its own proactive insights and can naturally
   * weave them into an answer ("by the way, I noticed…") instead of only
   * pushing them through the separate nudge channel.
   *
   * FAIL-SAFE: never throws — a reader fault resolves to `[]` so a turn
   * is never broken by the side-channel. When no reader is wired the
   * loop simply has no pending proposals to surface.
   */
  pendingProposals(
    tenantId: string,
    limit?: number,
  ): Promise<ReadonlyArray<EstateProposal>>;
}

/**
 * Durable read-port for the slow loop's surfaced proposals.
 *
 * The slow loop EMITS proposals through {@link ProposalSink} (which
 * persists `proactive_nudge` rows). This port is its READ counterpart:
 * the composition root implements it over the SAME durable store so a
 * fast-loop turn can pull the tenant's pending proposals back out. Kept
 * separate from the sink so a restart resumes from the persisted rows
 * rather than volatile in-process state.
 *
 * FAIL-SAFE CONTRACT: `read` MUST NOT throw — a store fault resolves to
 * `[]`. The implementation is budget-bounded by the caller; it should be
 * cheap per call (it runs on the fast path).
 */
export interface PendingProposalReader {
  read(input: {
    readonly tenantId: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<EstateProposal>>;
}

const DEFAULT_PENDING_PROPOSAL_LIMIT = 3;

export function createEstateMind(
  deps: EstateMindDeps,
  /**
   * Optional READ-port for the slow loop's surfaced proposals. When
   * supplied, `pendingProposals(...)` returns the tenant's open
   * proposals from the durable store so a fast-loop turn can become
   * aware of the MD's own proactive insights. When omitted, the method
   * resolves to `[]` (the loop only emits; it never reads back).
   */
  pendingReader?: PendingProposalReader | null,
): EstateMind {
  const now = deps.now ?? (() => Date.now());
  const pruneIdleMs = deps.pruneIdleMs ?? DEFAULT_PRUNE_IDLE_MS;
  const logger = deps.logger ?? NOOP_LOGGER;
  const { situationalModel, motivation } = deps;
  const thresholdsResolver = deps.thresholdsResolver ?? null;

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

    // ── GAP-WATCH — the Capability Gap Register blocker-clear sweep (Loop A).
    // Part of RECONCILE: re-probe every OPEN capability gap against the live
    // capability snapshot (registered tools / wired organs / flags / approvals
    // / evidence); on a clear, drive the verifier-gated auto-completion
    // (sovereign-parks, stale-resume-revalidates, no false-green). FAIL-SAFE: a
    // gap-watch fault degrades the tick, never breaks it.
    let gapWatch: GapWatchSummary | null = null;
    if (deps.gapWatch) {
      try {
        gapWatch = await deps.gapWatch.watch({ tenantId, nowMs });
        if (gapWatch.degradedReason && !degradedReason) {
          degradedReason = `gap-watch:${gapWatch.degradedReason}`;
        }
      } catch (err) {
        // The port contract says watch never throws; belt-and-braces guard the
        // boundary so a pathological implementation can never break the tick.
        degradedReason = degradedReason ?? 'gap-watch-failed';
        logger.warn('estate-mind: gap-watch failed', {
          tenantId,
          error: errMsg(err),
        });
      }
    }

    // ── MOTIVATE — standing drives → self-formulated goals (no trigger) ────
    // Resolve THIS tenant's schema-conditioned thresholds (the consolidated
    // baseline band) and judge the drives against THAT, so a breach fires on
    // what is anomalous for this estate — not a global static floor. HONEST-
    // DEGRADE: no resolver wired, a `null` result, or a resolver fault → omit
    // the override and the drives use their construction-time defaults (exactly
    // today's behaviour). The resolve NEVER throws to the tick.
    let perTenantThresholds: DriveThresholds | null = null;
    if (thresholdsResolver) {
      try {
        perTenantThresholds = await thresholdsResolver(tenantId);
      } catch (err) {
        if (!degradedReason) degradedReason = 'thresholds-resolve-failed';
        logger.warn('estate-mind: thresholds resolve failed', {
          tenantId,
          error: errMsg(err),
        });
      }
    }
    const goals = perTenantThresholds
      ? motivation.formulateGoals(snapshot, perTenantThresholds)
      : motivation.formulateGoals(snapshot);

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
      gapWatch,
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

  async function pendingProposals(
    tenantId: string,
    limit: number = DEFAULT_PENDING_PROPOSAL_LIMIT,
  ): Promise<ReadonlyArray<EstateProposal>> {
    if (!tenantId || !pendingReader) return [];
    const safeLimit =
      Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : DEFAULT_PENDING_PROPOSAL_LIMIT;
    try {
      const rows = await pendingReader.read({ tenantId, limit: safeLimit });
      return rows.slice(0, safeLimit);
    } catch (err) {
      // FAIL-SAFE — the fast-loop turn is never broken by the side-channel.
      logger.warn('estate-mind: pendingProposals read failed', {
        tenantId,
        error: errMsg(err),
      });
      return [];
    }
  }

  return { tick, cycle, pendingProposals };
}

/**
 * In-memory {@link PendingProposalReader} for tests / dev. Backed by the
 * same proposals the loop emits, keyed by tenant; newest-first. Pairs
 * with an in-memory proposal sink in a single-process dev harness.
 */
export function createInMemoryPendingProposalReader(
  source: ReadonlyArray<EstateProposal> | (() => ReadonlyArray<EstateProposal>),
): PendingProposalReader {
  return {
    async read({ tenantId, limit }) {
      const all = typeof source === 'function' ? source() : source;
      return all
        .filter((p) => p.tenantId === tenantId)
        .sort((a, b) => b.proposedAtMs - a.proposedAtMs)
        .slice(0, Math.max(0, limit));
    },
  };
}

function toProposal(goal: MotivatedGoal, nowMs: number): EstateProposal {
  return Object.freeze({
    tenantId: goal.tenantId,
    id: goal.id,
    driveId: goal.driveId,
    title: goal.title,
    rationale: goal.rationale,
    // ABSOLUTE single-language mandate (CLAUDE.md): the proposal copy must
    // be in the owner's active language. MotivatedGoal is locale-free, so
    // the kernel defaults to 'en'; the EstateMind tick should source the
    // tenant's active locale and stamp it here (composition-root concern,
    // estate-mind-wiring.ts).
    locale: 'en',
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
