/**
 * org-loop-due-sweep.ts — the FAST-PATH caller for `onCommitmentDue`.
 *
 * WHAT THIS CLOSES
 * ----------------
 * The orchestrator exposed `onCommitmentDue(tenantId, commitment)` — the
 * real-time FAST-PATH that threads ONE just-DUE commitment through the whole
 * delegation spine (STRATEGIZE → PICK → HITL → DISPATCH → BRIEF) — but it had
 * ZERO production callers. The orchestrator's own `tickOnce`/`start` sweep
 * re-scans `listLive` + `needsDelegation` on a slow (default 5-min) cadence and
 * never keys off a commitment's DUE moment. So a time-triggered commitment whose
 * `trigger_due_at` just passed sat undelegated until the next generic sweep.
 *
 * This supervisor is that caller. It scans the SAME time-trigger claim the
 * WaitFor time-path uses (`repo.listDueByTime(tenantId, now)` — time-trigger
 * rows whose due timestamp has passed and that are still delegatable) and
 * invokes `orchestrator.onCommitmentDue(tenantId, commitment)` for each, so a
 * commitment becoming DUE actually fires the real-time delegation lane.
 *
 * IDEMPOTENT BY CONSTRUCTION
 * --------------------------
 * `onCommitmentDue` (→ `threadCommitment`) de-dupes against the durable
 * `org_loop_runs` row: a commitment that already has a dispatched run (taskId),
 * is parked at the HITL gate, or is closed is SKIPPED. Re-scanning the same due
 * commitment across ticks therefore threads it AT MOST ONCE — safe to poll.
 *
 * TENANT SCOPE (no RLS-darkness)
 * ------------------------------
 * Tenants come from the SAME injected `listActiveTenantIds` the orchestrator's
 * own sweep uses; `listDueByTime(tenantId, …)` is asserted tenant-scoped and the
 * repo binds its per-tenant service-role context internally (the existing worker
 * context — this file introduces no new query path and no cross-tenant read).
 *
 * FAIL-SAFE + LEADER-GATED
 * ------------------------
 * Every hop (tenant list, per-tenant claim, per-commitment thread) is
 * try/caught; a fault degrades that unit and the tick continues. `start()` is a
 * kill-switch-gated (`BORJIE_ORG_LOOP`, DEFAULT-ON, NODE_ENV=test inert),
 * `unref`-ed interval wrapped by `withClusterLeader(...)` at the index.ts site
 * so only the elected leader polls. No `console.*` (Pino-shim only).
 */

import type { MdCommitment, MdCommitmentRepository } from '@borjie/database/repositories';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import {
  clampInterval,
  errMsg,
  killSwitchOff,
  needsDelegation,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_COMMITMENTS_PER_TENANT,
  DEFAULT_MAX_TENANTS_PER_TICK,
  type OrgLoopThreadOutcome,
} from './org-loop-types.js';

/** The slice of the orchestrator the due-sweep drives — the fast-path only. */
export interface DueSweepOrchestrator {
  onCommitmentDue(
    tenantId: string,
    commitment: MdCommitment,
  ): Promise<OrgLoopThreadOutcome>;
}

export interface CreateOrgLoopDueSweepDeps {
  /** The commitment store — `listDueByTime` is the time-trigger claim. */
  readonly commitmentRepo: Pick<MdCommitmentRepository, 'listDueByTime'>;
  /** The delegation fast-path this sweep calls per due commitment. */
  readonly orchestrator: DueSweepOrchestrator;
  /** Active-tenant source (SAME lister the orchestrator sweep uses). */
  readonly listActiveTenantIds: (() => Promise<ReadonlyArray<string>>) | null;
  readonly logger?: PinoLikeLogger;
  readonly clock?: () => Date;
  readonly env?: NodeJS.ProcessEnv;
  /** Poll cadence (ms). Bounded by `clampInterval`. Default = sweep cadence. */
  readonly intervalMs?: number;
  readonly maxTenantsPerTick?: number;
  readonly maxCommitmentsPerTenant?: number;
  /** Explicit gate (tests). Default = NODE_ENV!=='test' && kill-switch not off. */
  readonly enabled?: boolean;
}

export interface OrgLoopDueSweepResult {
  readonly tenantsScanned: number;
  readonly commitmentsDue: number;
  readonly threaded: number;
  readonly dispatched: number;
  readonly proposedForApproval: number;
  readonly skipped: number;
  readonly failed: number;
}

export interface OrgLoopDueSweep {
  /** Run ONE due-sweep across active tenants immediately (tests + manual). */
  tickOnce(): Promise<OrgLoopDueSweepResult>;
  /** Leader-gated start (ClusterCronSupervisor-compatible). */
  start(): void;
  stop(): void;
  readonly intervalMs: number;
  readonly enabled: boolean;
}

const ZERO_RESULT: OrgLoopDueSweepResult = Object.freeze({
  tenantsScanned: 0,
  commitmentsDue: 0,
  threaded: 0,
  dispatched: 0,
  proposedForApproval: 0,
  skipped: 0,
  failed: 0,
});

/** Tally one fast-path outcome into the sweep counters (immutable-friendly). */
function tally(
  outcome: OrgLoopThreadOutcome,
  counters: {
    threaded: number;
    dispatched: number;
    proposedForApproval: number;
    skipped: number;
    failed: number;
  },
): void {
  counters.threaded += 1;
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

export function createOrgLoopDueSweep(
  deps: CreateOrgLoopDueSweepDeps,
): OrgLoopDueSweep {
  const logger = deps.logger ?? createPinoLikeLogger('org-loop-due-sweep');
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => new Date());
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

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  /** Thread the DUE, delegatable commitments for one tenant. Never throws. */
  async function sweepTenant(
    tenantId: string,
    nowMs: number,
    counters: {
      commitmentsDue: number;
      threaded: number;
      dispatched: number;
      proposedForApproval: number;
      skipped: number;
      failed: number;
    },
  ): Promise<void> {
    let due: ReadonlyArray<MdCommitment>;
    try {
      due = await deps.commitmentRepo.listDueByTime(tenantId, nowMs);
    } catch (err) {
      counters.failed += 1;
      logger.warn(
        { tenantId, err: errMsg(err) },
        'org-loop-due-sweep: listDueByTime failed (store fault — tenant skipped, tick continues)',
      );
      return;
    }
    // Only thread commitments the spine actually delegates; the fast-path
    // itself re-de-dupes against the durable run, so re-scans are safe.
    const needing = due.filter(needsDelegation).slice(0, maxCommitments);
    for (const commitment of needing) {
      counters.commitmentsDue += 1;
      try {
        tally(
          await deps.orchestrator.onCommitmentDue(tenantId, commitment),
          counters,
        );
      } catch (err) {
        counters.failed += 1;
        logger.error(
          { tenantId, commitmentId: commitment.id, err: errMsg(err) },
          'org-loop-due-sweep: onCommitmentDue threw (fail-safe — should never happen; fast-path is try/caught internally)',
        );
      }
    }
  }

  async function tickOnce(): Promise<OrgLoopDueSweepResult> {
    if (running) return ZERO_RESULT;
    running = true;
    const nowMs = clock().getTime();
    const counters = {
      commitmentsDue: 0,
      threaded: 0,
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
        tenantsScanned += 1;
        await sweepTenant(tenantId, nowMs, counters);
      }
    } catch (err) {
      counters.failed += 1;
      logger.error(
        { err: errMsg(err) },
        'org-loop-due-sweep: tick failed (fail-safe — the poll keeps its cadence)',
      );
    } finally {
      running = false;
    }
    return Object.freeze({ tenantsScanned, ...counters });
  }

  logger.info(
    {
      wiring: 'org-loop-due-sweep',
      tenantSourceWired: deps.listActiveTenantIds !== null,
      intervalMs,
      maxTenantsPerTick: maxTenants,
      enabled,
    },
    'org-loop-due-sweep: fast-path caller composed (listDueByTime → onCommitmentDue) — a DUE commitment now fires real-time delegation',
  );

  return {
    intervalMs,
    enabled,
    tickOnce,
    start(): void {
      if (!enabled) {
        logger.info({ intervalMs }, 'org-loop-due-sweep: disabled (no start)');
        return;
      }
      if (timer) {
        logger.warn({}, 'org-loop-due-sweep: already running, ignoring duplicate start');
        return;
      }
      logger.info({ intervalMs }, 'org-loop-due-sweep: started (leader-gated fast-path poll)');
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
