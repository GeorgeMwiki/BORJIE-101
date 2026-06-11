/**
 * org-loop-orchestrator.ts — THE SELF-RUNNING-ORG SPINE (G4 integrator).
 *
 * WHAT THIS CLOSES
 * ----------------
 * The chain ENDS were live (detect-gap, flag-owner, guide-assist,
 * report-progress) but the MIDDLE was dark: `assignTask()` had zero callers
 * because its `WorkforceDeps` was never composed, and nothing threaded the
 * stages as ONE durable, resumable run. This module is that thread. It
 * integrates the four spine ports (STRATEGIZE → PICK → ACT/DISPATCH → BRIEF)
 * over the durable `org_loop_runs` correlation identity so the MD's
 *
 *   DETECT-GAP → STRATEGIZE → PICK-PERSON → ASSIGN → DELIVER → GUIDE →
 *   COMPLETE → LEARN
 *
 * loop runs end-to-end, every external step is fail-isolated (a fault advances
 * the run to `failed` + logs, never throws into the caller), and a HIGH /
 * sovereign assignment is PROPOSED for owner approval rather than auto-executed.
 *
 * TWO ENTRY POINTS
 * ----------------
 *   - `onCommitmentDue(tenantId, commitment, driveContext?)` — the chat/event
 *     FAST-PATH. A single commitment is threaded through the whole spine.
 *   - `start()/stop()` — a leader-gated, `unref`-ed interval (kill-switch
 *     `BORJIE_ORG_LOOP`, DEFAULT-ON, NODE_ENV=test inert) that SWEEPS open
 *     commitments needing delegation across active tenants and runs the thread
 *     for each. Mirrors the estate-mind / loop-economy supervisors exactly.
 *
 * LOOP-FLEXIBILITY LAW
 * --------------------
 * The loop ENGINE is universal Mr-Mwikila core; the mining loop CONTENT
 * (domains, task shapes) is domain-pack DATA carried by the injected ports +
 * the `org_loop_runs` row. The spine is registered as a loop-economy
 * `LoopSpec` (origin='builtin', `createOrgLoopLoopSpec`) so it COMPOSES with the
 * loop-economy substrate instead of being a hardcoded per-vertical branch.
 *
 * HARD RAILS (CLAUDE.md)
 * ----------------------
 *   - PROPOSE-ONLY / HITL: a HIGH or SOVEREIGN risk assignment is NEVER
 *     auto-executed — it is surfaced through the gated proposal sink for owner
 *     approval (the run parks at the `report` stage, status `open`, awaiting the
 *     owner's decision; `assignTask` is not called).
 *   - Evidence-required: the commitment's `evidenceIds` thread into the run and
 *     into the dispatch trace.
 *   - Fail-safe: every external hop is try/caught; the outer tick + per-tenant
 *     pass never throw.
 *   - Pino-shim logger only; NO console.*. Immutable outputs (frozen).
 *
 * FILE LAYOUT (file-size rule — each unit <800 lines)
 * ---------------------------------------------------
 *   - ./org-loop-types.ts        — identity constants, port + outcome types,
 *                                  pure helpers, the LoopSpec factory.
 *   - THIS file                  — the `createOrgLoopOrchestrator` factory: the
 *                                  staged thread + the leader-gated sweep.
 */

import type { ScoredCandidate } from '@borjie/workforce-orchestrator';
import type { CompetenceDomain, DriveContext } from './strategize-port.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import {
  ORG_LOOP_CRON_NAME,
  ORG_LOOP_KILL_SWITCH_ENV,
  ORG_LOOP_SPEC_ID,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_COMMITMENTS_PER_TENANT,
  DEFAULT_MAX_TENANTS_PER_TICK,
  ZERO_TICK,
  clampInterval,
  createOrgLoopLoopSpec,
  errMsg,
  killSwitchOff,
  needsDelegation,
  previewRequiresApproval,
  strategyJsonOf,
  strategyToMatchNeed,
  toDispatchTrace,
  toRunView,
  type AdvanceOrgLoopRunInput,
  type CockpitPublisher,
  type CreateOrgLoopOrchestratorDeps,
  type MdCommitment,
  type OrgLoopCockpitEvent,
  type OrgLoopOrchestrator,
  type OrgLoopRun,
  type OrgLoopThreadOutcome,
  type OrgLoopTickResult,
  type StrategyTrace,
  type TaskDispatchResult,
} from './org-loop-types.js';

// Re-export the public surface so index.ts + tests import everything the lane
// exposes from the orchestrator module (one canonical import path).
export * from './org-loop-types.js';

export function createOrgLoopOrchestrator(
  deps: CreateOrgLoopOrchestratorDeps,
): OrgLoopOrchestrator {
  const logger = deps.logger ?? createPinoLikeLogger('org-loop');
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => new Date());
  const ownerLocale = deps.ownerLocale ?? 'en';
  const intervalMs = clampInterval(deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  const maxTenants = Math.max(
    1,
    deps.maxTenantsPerTick ?? DEFAULT_MAX_TENANTS_PER_TICK,
  );
  const maxCommitments = Math.max(
    1,
    deps.maxCommitmentsPerTenant ?? DEFAULT_MAX_COMMITMENTS_PER_TENANT,
  );
  const enabled =
    deps.enabled ?? (env.NODE_ENV !== 'test' && !killSwitchOff(env));

  const loopSpec = createOrgLoopLoopSpec({
    createdAtMs: clock().getTime(),
    everyMs: intervalMs,
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  // ── Small fail-isolated effect helpers (each <50 lines). ──

  function publishCockpit(event: OrgLoopCockpitEvent): void {
    if (!deps.cockpit) return;
    try {
      (deps.cockpit as CockpitPublisher).publish(event);
    } catch (err) {
      logger.warn(
        { tenantId: event.tenantId, err: errMsg(err) },
        'org-loop: cockpit publish failed (forensic only — thread unaffected)',
      );
    }
  }

  function advanceEvent(
    tenantId: string,
    runId: string,
    commitmentId: string,
    stage: string,
    extra: Record<string, unknown>,
  ): void {
    publishCockpit({
      kind: 'mwikila.acted',
      tenantId,
      actionKind: 'mining.org_loop.advance',
      summary: JSON.stringify({ commitmentId, runId, stage, ...extra }),
    });
  }

  /** Advance the run, swallowing a store fault (the thread continues honestly). */
  async function advanceRun(
    tenantId: string,
    runId: string,
    patch: AdvanceOrgLoopRunInput,
  ): Promise<void> {
    try {
      await deps.runRepo.advance(tenantId, runId, patch);
    } catch (err) {
      logger.warn(
        { tenantId, runId, err: errMsg(err) },
        'org-loop: run advance failed (store fault — thread continues, run may be stale)',
      );
    }
  }

  /** Mark a run failed (best-effort) and return the failure outcome. */
  async function failRun(
    tenantId: string,
    runId: string | null,
    reason: string,
  ): Promise<OrgLoopThreadOutcome> {
    if (runId) {
      await advanceRun(tenantId, runId, { stage: 'closed', status: 'failed' });
    }
    logger.warn({ tenantId, runId, reason }, 'org-loop: run FAILED (fail-safe)');
    return Object.freeze({ kind: 'failed', runId, reason });
  }

  /** Create the run (or reuse the existing one). Returns null on a store fault. */
  async function ensureRun(
    tenantId: string,
    commitment: MdCommitment,
    trace: StrategyTrace,
    driveContext: DriveContext | undefined,
    existing: OrgLoopRun | null,
  ): Promise<OrgLoopRun | null> {
    if (existing) return existing;
    try {
      return await deps.runRepo.create({
        tenantId,
        commitmentId: commitment.id,
        loopKind: ORG_LOOP_SPEC_ID,
        stage: 'dispatch',
        status: 'open',
        driveId: driveContext?.driveId ?? null,
        strategyJson: strategyJsonOf(trace),
        // Evidence-required: the gap's evidence chain travels with the loop.
        evidenceIds: [...trace.evidenceIds],
        sourceData: {
          commitmentKind: commitment.kind,
          gapKind: commitment.gapKind ?? null,
          competenceDomain: trace.taskShape.competenceDomain,
        },
      });
    } catch (err) {
      logger.warn(
        { tenantId, commitmentId: commitment.id, err: errMsg(err) },
        'org-loop: run create failed (store fault)',
      );
      return null;
    }
  }

  /** Build + propose the owner brief through the gated sink. Never throws. */
  async function surfaceBrief(
    tenantId: string,
    run: OrgLoopRun,
    trace: StrategyTrace,
    candidate: ScoredCandidate,
    competenceDomain: CompetenceDomain,
    commitment: MdCommitment,
  ): Promise<void> {
    try {
      const view = toRunView({
        run,
        trace,
        candidate,
        competenceDomain,
        driveId: run.driveId,
        gapKind: commitment.gapKind ?? null,
        proposedAtMs: clock().getTime(),
      });
      await deps.proposalSink.propose(deps.briefer.brief(view, ownerLocale));
    } catch (err) {
      logger.warn(
        { tenantId, runId: run.id, err: errMsg(err) },
        'org-loop: owner brief failed (gated sink fault — assignment still landed)',
      );
    }
  }

  // ── Stage helpers — each a single spine stage, all <50 lines. ──

  /** HITL stage: park the run + brief the owner; never auto-execute. */
  async function proposeForApproval(
    tenantId: string,
    run: OrgLoopRun,
    trace: StrategyTrace,
    top: ScoredCandidate,
    competenceDomain: CompetenceDomain,
    commitment: MdCommitment,
  ): Promise<OrgLoopThreadOutcome> {
    await advanceRun(tenantId, run.id, {
      stage: 'report',
      status: 'open',
      chosenEmployeeId: top.employeeId,
      matchConfidence: top.confidence,
      strategyJson: strategyJsonOf(trace),
    });
    await surfaceBrief(tenantId, run, trace, top, competenceDomain, commitment);
    advanceEvent(tenantId, run.id, commitment.id, 'awaiting_approval', {
      chosenEmployeeId: top.employeeId,
    });
    logger.info(
      { tenantId, runId: run.id, commitmentId: commitment.id, chosenEmployeeId: top.employeeId },
      'org-loop: HIGH/sovereign assignment surfaced for owner approval (propose-only HITL — NOT auto-executed)',
    );
    return Object.freeze({
      kind: 'proposed_for_approval',
      runId: run.id,
      chosenEmployeeId: top.employeeId,
    });
  }

  /** ACT stage: dispatch (assign+deliver+guide), record the taskId, brief. */
  async function dispatchAndBrief(
    tenantId: string,
    run: OrgLoopRun,
    trace: StrategyTrace,
    top: ScoredCandidate,
    competenceDomain: CompetenceDomain,
    commitment: MdCommitment,
  ): Promise<OrgLoopThreadOutcome> {
    await advanceRun(tenantId, run.id, {
      stage: 'dispatch',
      status: 'active',
      chosenEmployeeId: top.employeeId,
      matchConfidence: top.confidence,
      strategyJson: strategyJsonOf(trace),
    });
    let result: TaskDispatchResult;
    try {
      result = await deps.dispatcher.dispatch(
        toDispatchTrace({
          tenantId,
          chosenEmployeeId: top.employeeId,
          trace,
          commitmentId: commitment.id,
        }),
      );
    } catch (err) {
      return failRun(tenantId, run.id, `dispatch: ${errMsg(err)}`);
    }
    // Record the forward-edge (taskId) so completion closes back here, then brief.
    await advanceRun(tenantId, run.id, {
      stage: 'deliver',
      status: 'active',
      taskId: result.taskId,
    });
    await surfaceBrief(tenantId, run, trace, top, competenceDomain, commitment);
    advanceEvent(tenantId, run.id, commitment.id, 'dispatched', {
      taskId: result.taskId,
      chosenEmployeeId: top.employeeId,
    });
    logger.info(
      {
        tenantId,
        runId: run.id,
        commitmentId: commitment.id,
        taskId: result.taskId,
        chosenEmployeeId: top.employeeId,
        riskTier: result.riskTier,
        followupCount: result.followupCount,
        delivered: result.notificationDelivered,
      },
      'org-loop: gap delegated end-to-end (strategize → pick → dispatch → deliver → brief) — the spine fired',
    );
    return Object.freeze({
      kind: 'dispatched',
      runId: run.id,
      taskId: result.taskId,
      chosenEmployeeId: top.employeeId,
    });
  }

  /** Resolve the live run for this commitment (de-dupe / resume). */
  async function findExistingRun(
    tenantId: string,
    commitment: MdCommitment,
  ): Promise<OrgLoopRun | null> {
    try {
      return await deps.runRepo.findByCommitment(tenantId, commitment.id);
    } catch (err) {
      logger.warn(
        { tenantId, commitmentId: commitment.id, err: errMsg(err) },
        'org-loop: findByCommitment failed — proceeding may double-create (honest degrade)',
      );
      return null;
    }
  }

  // ── The single thread — STRATEGIZE → PICK → (HITL) → DISPATCH → BRIEF ──
  async function threadCommitment(
    tenantId: string,
    commitment: MdCommitment,
    driveContext?: DriveContext,
  ): Promise<OrgLoopThreadOutcome> {
    const existing = await findExistingRun(tenantId, commitment);
    if (existing && existing.taskId) {
      return Object.freeze({
        kind: 'skipped',
        reason: 'already dispatched (live run carries a taskId)',
      });
    }

    // STRATEGIZE (G3) — what is the corrective work? Never throws out.
    let trace: StrategyTrace;
    try {
      trace = await deps.strategist.strategize(tenantId, commitment, driveContext);
    } catch (err) {
      return failRun(tenantId, existing?.id ?? null, `strategize: ${errMsg(err)}`);
    }
    const competenceDomain = trace.taskShape.competenceDomain;

    // PICK (G2) — who is the best person? Empty → park at pick.
    let candidates: ScoredCandidate[];
    try {
      candidates = await deps.personMatcher.match(tenantId, strategyToMatchNeed(trace));
    } catch (err) {
      return failRun(tenantId, existing?.id ?? null, `match: ${errMsg(err)}`);
    }
    const top = candidates[0];
    if (!top) {
      const parked = await ensureRun(tenantId, commitment, trace, driveContext, existing);
      if (parked) {
        await advanceRun(tenantId, parked.id, {
          stage: 'pick',
          status: 'open',
          strategyJson: strategyJsonOf(trace),
        });
      }
      return Object.freeze({
        kind: 'skipped',
        reason: 'no eligible workforce candidate (run parked at pick)',
      });
    }

    // Create / resume the durable run (the close-the-loop back-edge).
    const run = await ensureRun(tenantId, commitment, trace, driveContext, existing);
    if (!run) return failRun(tenantId, null, 'run create failed (no row)');

    // HITL GUARD — a HIGH/sovereign assignment is PROPOSED, not executed.
    if (commitment.sovereign || previewRequiresApproval(trace)) {
      return proposeForApproval(tenantId, run, trace, top, competenceDomain, commitment);
    }
    return dispatchAndBrief(tenantId, run, trace, top, competenceDomain, commitment);
  }

  // ── The sweep — open commitments needing delegation across tenants. ──
  function tallyOutcome(
    outcome: OrgLoopThreadOutcome,
    counters: {
      dispatched: number;
      proposedForApproval: number;
      skipped: number;
      failed: number;
    },
  ): void {
    switch (outcome.kind) {
      case 'dispatched':
        counters.dispatched += 1;
        break;
      case 'proposed_for_approval':
        counters.proposedForApproval += 1;
        break;
      case 'skipped':
        counters.skipped += 1;
        break;
      case 'failed':
        counters.failed += 1;
        break;
    }
  }

  async function sweepTenant(
    tenantId: string,
    counters: {
      commitmentsThreaded: number;
      dispatched: number;
      proposedForApproval: number;
      skipped: number;
      failed: number;
    },
  ): Promise<void> {
    const commitments = await deps.commitmentRepo.listLive(tenantId);
    const needing = commitments.filter(needsDelegation).slice(0, maxCommitments);
    for (const commitment of needing) {
      counters.commitmentsThreaded += 1;
      tallyOutcome(await threadCommitment(tenantId, commitment), counters);
    }
  }

  async function tickOnce(): Promise<OrgLoopTickResult> {
    if (running) return ZERO_TICK;
    running = true;
    const counters = {
      commitmentsThreaded: 0,
      dispatched: 0,
      proposedForApproval: 0,
      skipped: 0,
      failed: 0,
    };
    let tenantsScanned = 0;
    try {
      const tenantIds = deps.listActiveTenantIds
        ? (await deps.listActiveTenantIds()).slice(0, maxTenants)
        : [];
      for (const tenantId of tenantIds) {
        try {
          tenantsScanned += 1;
          await sweepTenant(tenantId, counters);
        } catch (err) {
          counters.failed += 1;
          logger.error(
            { tenantId, err: errMsg(err) },
            'org-loop: tenant sweep failed (fail-safe — tick continues)',
          );
        }
      }
    } catch (err) {
      logger.error(
        { err: errMsg(err) },
        'org-loop: tick failed (fail-safe — loop keeps its cadence)',
      );
    } finally {
      running = false;
    }
    return Object.freeze({ tenantsScanned, ...counters });
  }

  // BOOT-PROOF SIGNAL — this line at composition time is the detectable proof
  // the spine is no longer dark (mirrors 'loop-economy: ... composed').
  logger.info(
    {
      wiring: 'org-loop',
      loopSpecId: loopSpec.id,
      loopOrigin: loopSpec.origin,
      cronName: ORG_LOOP_CRON_NAME,
      tenantSourceWired: deps.listActiveTenantIds !== null,
      cockpitWired: Boolean(deps.cockpit),
      ownerLocale,
      intervalMs,
      maxTenantsPerTick: maxTenants,
      killSwitchEnvFlag: ORG_LOOP_KILL_SWITCH_ENV,
      enabled,
    },
    'org-loop: self-running-org SPINE composed (STRATEGIZE → PICK → HITL → DISPATCH → BRIEF over org_loop_runs); HIGH/sovereign assignments are propose-only',
  );

  return {
    loopSpec,
    intervalMs,
    enabled,
    onCommitmentDue: threadCommitment,
    tickOnce,
    start(): void {
      if (!enabled) {
        logger.info(
          { intervalMs, killSwitchEnvFlag: ORG_LOOP_KILL_SWITCH_ENV },
          'org-loop: disabled (no start)',
        );
        return;
      }
      if (timer) {
        logger.warn({}, 'org-loop: already running, ignoring duplicate start');
        return;
      }
      logger.info({ intervalMs }, 'org-loop: started (leader-gated sweep)');
      timer = setInterval(() => {
        void tickOnce();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
