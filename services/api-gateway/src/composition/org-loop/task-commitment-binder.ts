/**
 * task-commitment-binder.ts — the SELF-RUNNING-ORG spine RE-LOOP CLOSURE binder
 * (the synchronous fast-path that closes the loop in real time).
 *
 * THE STAGE THIS IS
 * -----------------
 * The self-running-org loop is DETECT-GAP → STRATEGIZE → PICK-PERSON → ASSIGN →
 * DELIVER → GUIDE → COMPLETE → LEARN. This binder is the COMPLETE → close-back
 * synapse: when a worker marks a task done, `tasks.hono.ts /:id/complete`
 * publishes a `mwikila.acted` cockpit event (actionKind `mining.task.complete`).
 * This binder listens for THAT event, joins the completed task back to the
 * `org_loop_run` it spawned (`findByTask`), marks the ORIGINATING md_commitment
 * `done` with positive proof (`markDone`), advances the run to its terminal
 * `closed` stage/status, and pulses the owner cockpit that the loop closed.
 *
 * It is the SYNCHRONOUS fast-path: the cron reconcile sweep would eventually
 * close the loop, but riding the live cockpit bus closes it in real time the
 * instant the worker taps "done".
 *
 * THE VERIFICATION GATE (Principle 12)
 * ------------------------------------
 * Not every claimed completion is true. A DETERMINISTIC ~15% sample of closures
 * is flagged for a spot-check. The sample is a STABLE HASH of the taskId — never
 * a nondeterministic RNG — so the same task always lands the same way (idempotent
 * replays never flip the verdict, and the gate is testable). On a (stubbed) fail
 * the binder writes a DOWN-WEIGHT to `performance_signals` via the optional
 * `performanceSink`, so §G2's matcher LEARNS to weight that person down for the
 * domain. The gate never blocks the close (the work IS reported done); it only
 * feeds the learning loop.
 *
 * FAULT TOLERANCE (CLAUDE.md)
 * ---------------------------
 * Everything is fault-tolerant: a malformed event, a task with no loop-run, a
 * markDone fault, a sink fault — NONE may throw into the cockpit bus (an
 * unhandled throw in a bus handler would tear the publisher's hot path). Every
 * branch logs + returns. Immutable inputs; the binder never mutates the event.
 *
 * Pino-shim only; NO console.*.
 */

import { z } from 'zod';

// Import the repository types from the explicit `./repositories` subpath (not
// the root barrel). The root `@borjie/database` barrel `export *`-merges the
// schema + repository barrels, which collapses these names to a namespace under
// the current build state (TS2709 "cannot use namespace as a type"); the subpath
// resolves the clean type — the same idiom the living-md wiring uses.
import type {
  MdCommitmentRepository,
  OrgLoopRun,
  OrgLoopRunRepository,
} from '@borjie/database/repositories';

import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import {
  publishCockpitEvent,
  subscribeCockpitEvents,
} from '../../services/cockpit-events/bus.js';
import type { CockpitEvent } from '../../services/cockpit-events/types.js';

// ─────────────────────────────────────────────────────────────────────
// Ports the binder depends on (structural — kept import-light).
// ─────────────────────────────────────────────────────────────────────

/**
 * The cockpit publish seam the binder needs (pulse the owner that the loop
 * closed). Structural so the binder is trivially testable with a fake; defaults
 * to the real `publishCockpitEvent`.
 */
export interface CockpitPublishPort {
  publish(event: CockpitEvent): void;
}

/**
 * The LEARN sink (Principle 12). When a deterministic spot-check flags a closure
 * the binder writes a NEGATIVE performance signal for the chosen employee +
 * competence domain so §G2's matcher weights them down next time. OPTIONAL: the
 * `performance_signals` history table is not yet in the live schema, so the spine
 * wires this only once that lands — until then the gate logs the down-weight
 * structurally (never fabricates a row). Best-effort + never throws.
 */
export interface PerformanceSink {
  downWeight(signal: PerformanceDownWeight): Promise<void>;
}

/** A negative performance signal the verification gate emits on a flagged fail. */
export interface PerformanceDownWeight {
  readonly tenantId: string;
  /** The orchestrator employee id the loop chose for the (now flagged) task. */
  readonly employeeId: string;
  /** The completed task that failed the spot-check. */
  readonly taskId: string;
  /** The commitment the loop closed (the originating gap). */
  readonly commitmentId: string;
  /** Jagged-frontier coordinate the matcher learns on (when the run carries one). */
  readonly competenceDomain: string | null;
  /** The deterministic sample bucket [0,1) — for forensic traceability. */
  readonly sampleBucket: number;
  /** When the gate flagged the closure (ms). */
  readonly flaggedAtMs: number;
}

export interface CreateTaskCommitmentBinderArgs {
  readonly runRepo: OrgLoopRunRepository;
  readonly commitmentRepo: MdCommitmentRepository;
  readonly cockpit?: CockpitPublishPort;
  /** OPTIONAL LEARN sink — wired once `performance_signals` lands. */
  readonly performanceSink?: PerformanceSink | null;
  readonly logger?: PinoLikeLogger;
  /** Injected clock (returns a Date) — deterministic in tests. */
  readonly clock?: () => Date;
}

export interface TaskCommitmentBinder {
  /**
   * Handle one cockpit event. A NO-OP unless it is a `mwikila.acted` /
   * `mining.task.complete`. NEVER throws — every fault is logged + swallowed so
   * the cockpit bus publisher is never torn down by a handler error.
   */
  onMwikilaActed(event: CockpitEvent): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// The acted-event summary contract (mirrors tasks.hono.ts /:id/complete).
// ─────────────────────────────────────────────────────────────────────

/**
 * `tasks.hono.ts` publishes the completion as a JSON string in `summary`:
 * `{ taskId, parentRfbId, assignee, status, title }`. We only need `taskId`; the
 * rest is parsed leniently (the schema tolerates extra/missing fields so an
 * envelope evolution never breaks the close-back).
 */
const ActedSummarySchema = z
  .object({
    taskId: z.string().min(1),
    status: z.string().optional(),
  })
  .passthrough();

/** The completion confirmation kind stamped onto the closed commitment. */
const CONFIRMATION_KIND = 'task_completed';

/**
 * The deterministic verification-sample rate (Principle 12). ~15% of closures
 * are flagged for a spot-check. A constant, not a knob — the gate is a learning
 * feeder, not a policy surface.
 */
const VERIFICATION_SAMPLE_RATE = 0.15;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (deterministic; no IO).
// ─────────────────────────────────────────────────────────────────────

/**
 * A STABLE, deterministic sample bucket in [0, 1) for a taskId — the FNV-1a
 * 32-bit hash folded to a unit fraction. NEVER an RNG: the same taskId always
 * maps to the same bucket, so a replayed event yields the same verdict (the gate
 * is idempotent + testable). Pure.
 */
export function sampleBucketForTask(taskId: string): number {
  // FNV-1a 32-bit — small, fast, well-distributed, no deps.
  let hash = 0x811c9dc5;
  for (let i = 0; i < taskId.length; i += 1) {
    hash ^= taskId.charCodeAt(i);
    // 32-bit FNV prime multiply via shift-adds, kept inside 32 bits.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Fold the 32-bit hash to [0, 1).
  return hash / 0x1_0000_0000;
}

/**
 * True when a closure is sampled for the (stubbed) spot-check. Deterministic:
 * the stable bucket below the sample rate is flagged. Pure.
 */
export function isSampledForVerification(taskId: string): boolean {
  return sampleBucketForTask(taskId) < VERIFICATION_SAMPLE_RATE;
}

/**
 * Narrow a raw cockpit event to a `mining.task.complete` acted-event and extract
 * the taskId from its JSON summary. Returns null when the event is not the close
 * trigger or the summary is malformed (a non-completion event is a clean no-op).
 * Pure.
 */
export function parseTaskCompleteEvent(
  event: CockpitEvent,
): { readonly tenantId: string; readonly taskId: string; readonly emittedAt: string } | null {
  if (event.kind !== 'mwikila.acted') return null;
  if (event.actionKind !== 'mining.task.complete') return null;
  if (typeof event.summary !== 'string' || event.summary.length === 0) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(event.summary);
  } catch {
    return null;
  }
  const parsed = ActedSummarySchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    tenantId: event.tenantId,
    taskId: parsed.data.taskId,
    emittedAt: event.emittedAt,
  };
}

/** Read the run's competence domain off its strategy_json (best-effort). */
function competenceDomainOf(run: OrgLoopRun): string | null {
  const fromStrategy = run.strategyJson?.['competenceDomain'];
  if (typeof fromStrategy === 'string' && fromStrategy.length > 0) {
    return fromStrategy;
  }
  return null;
}

/** A stable, single-language closure subject for the owner cockpit pulse. */
function closureSubject(taskId: string): string {
  return `Task ${taskId} completed — loop closed`;
}

// ─────────────────────────────────────────────────────────────────────
// The binder.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the RE-LOOP CLOSURE binder. The main agent subscribes it to the cockpit
 * bus ONCE via `subscribeOrgLoopClosure(binder)` (or wires `onMwikilaActed`
 * directly into its own `subscribeCockpitEvents` call). Every fault is contained
 * — the binder never throws into the bus.
 */
export function createTaskCommitmentBinder(
  args: CreateTaskCommitmentBinderArgs,
): TaskCommitmentBinder {
  const { runRepo, commitmentRepo } = args;
  const cockpit: CockpitPublishPort =
    args.cockpit ?? { publish: publishCockpitEvent };
  const performanceSink = args.performanceSink ?? null;
  const logger = args.logger ?? createPinoLikeLogger('task-commitment-binder');
  const clock = args.clock ?? (() => new Date());

  /**
   * The deterministic verification gate (Principle 12). On a sampled-and-failed
   * closure, emit a down-weight so the matcher learns. Fully best-effort: a sink
   * fault is logged + swallowed (the close already committed). Stubbed fail
   * semantics: today a SAMPLED closure is treated as the spot-check candidate;
   * the real verifier verdict lands here later — the structural wiring is what
   * lights up §G2's learning loop.
   */
  async function runVerificationGate(
    run: OrgLoopRun,
    taskId: string,
  ): Promise<void> {
    if (!isSampledForVerification(taskId)) return;
    const bucket = sampleBucketForTask(taskId);
    const employeeId = run.chosenEmployeeId;
    const competenceDomain = competenceDomainOf(run);

    // No chosen employee → nothing to learn against; record the sample + return.
    if (!employeeId) {
      logger.info(
        {
          tenantId: run.tenantId,
          taskId,
          commitmentId: run.commitmentId,
          sampleBucket: bucket,
          organ: 'org-loop-verification',
        },
        'org-loop: closure sampled for spot-check but run has no chosen employee — no down-weight target',
      );
      return;
    }

    const signal: PerformanceDownWeight = Object.freeze({
      tenantId: run.tenantId,
      employeeId,
      taskId,
      commitmentId: run.commitmentId,
      competenceDomain,
      sampleBucket: bucket,
      flaggedAtMs: clock().getTime(),
    });

    if (!performanceSink) {
      // Honest degrade: the performance_signals table is not yet wired. Record
      // the down-weight STRUCTURALLY (never fabricate a row) so the gate is
      // observable + lights up automatically once the sink is injected.
      logger.info(
        { ...signal, organ: 'org-loop-verification' },
        'org-loop: closure flagged by spot-check — down-weight recorded structurally (performanceSink not wired yet)',
      );
      return;
    }

    try {
      await performanceSink.downWeight(signal);
      logger.info(
        { ...signal, organ: 'org-loop-verification' },
        'org-loop: closure flagged by spot-check — matcher down-weight written (LEARN)',
      );
    } catch (err) {
      logger.error(
        {
          ...signal,
          organ: 'org-loop-verification',
          err: err instanceof Error ? err.message : String(err),
        },
        'org-loop: performanceSink down-weight failed — closure already committed, learning signal dropped',
      );
    }
  }

  /** Pulse the owner cockpit that the loop closed. Best-effort; never throws. */
  function publishClosure(run: OrgLoopRun, taskId: string): void {
    try {
      cockpit.publish({
        kind: 'decision.recorded',
        tenantId: run.tenantId,
        emittedAt: clock().toISOString(),
        decisionId: `org-loop-closed:${run.id}`,
        subject: closureSubject(taskId),
        severity: 'low',
      });
    } catch (err) {
      logger.warn(
        {
          tenantId: run.tenantId,
          runId: run.id,
          taskId,
          err: err instanceof Error ? err.message : String(err),
        },
        'org-loop: closure cockpit pulse failed (non-fatal — the loop is already closed)',
      );
    }
  }

  return {
    async onMwikilaActed(event: CockpitEvent): Promise<void> {
      // The whole handler is wrapped: NOTHING may throw into the cockpit bus.
      try {
        const parsed = parseTaskCompleteEvent(event);
        if (!parsed) return; // Not a task-completion acted-event — clean no-op.

        const { tenantId, taskId, emittedAt } = parsed;

        const run = await runRepo.findByTask(tenantId, taskId);
        if (!run) {
          // A task without a loop-run is FINE — not every task is spine-spawned.
          return;
        }

        // Idempotency: a replayed completion event for an already-closed run is a
        // clean no-op (markDone is idempotent on `done`, but skip the writes +
        // duplicate pulse so a re-fire never storms).
        if (run.status === 'closed' && run.stage === 'closed') {
          return;
        }

        // CLOSE THE ORIGINATING COMMITMENT with positive proof. markDone REQUIRES
        // a confirmationKind (honest closure) + a Date confirmedAt; the acted
        // event carries an ISO string, so parse it to a Date (fall back to the
        // injected clock when the stamp is unparseable).
        const confirmedAt = parseIsoToDate(emittedAt) ?? clock();
        const closedCommitment = await commitmentRepo.markDone(
          tenantId,
          run.commitmentId,
          {
            confirmationKind: CONFIRMATION_KIND,
            confirmedAt,
          },
        );
        if (!closedCommitment) {
          // The commitment id did not resolve (already done via the generic
          // gap-segregation guard returns the row unchanged, or it is a gap row).
          // Log + still advance the run so the spine does not stall on a stale
          // commitment join.
          logger.warn(
            {
              tenantId,
              taskId,
              runId: run.id,
              commitmentId: run.commitmentId,
              organ: 'org-loop-closure',
            },
            'org-loop: markDone returned no row for the run commitment — advancing run to closed anyway (stale or gap-segregated commitment)',
          );
        }

        // ADVANCE THE RUN to its terminal stage/status.
        await runRepo.advance(tenantId, run.id, {
          stage: 'closed',
          status: 'closed',
        });

        logger.info(
          {
            tenantId,
            taskId,
            runId: run.id,
            commitmentId: run.commitmentId,
            chosenEmployeeId: run.chosenEmployeeId,
            organ: 'org-loop-closure',
          },
          'org-loop: task completion closed the loop (commitment done + run closed) — the spine COMPLETE→close synapse fired',
        );

        // VERIFICATION GATE (LEARN) — deterministic spot-check sample.
        await runVerificationGate(run, taskId);

        // Pulse the owner cockpit that the loop closed.
        publishClosure(run, taskId);
      } catch (err) {
        // The outermost rail: a fault here must NEVER propagate into the cockpit
        // bus publisher. Log + swallow.
        logger.error(
          {
            kind: event.kind,
            tenantId: event.tenantId,
            err: err instanceof Error ? err.message : String(err),
            organ: 'org-loop-closure',
          },
          'org-loop: closure binder faulted — contained (cockpit bus protected)',
        );
      }
    },
  };
}

/**
 * Parse an ISO-8601 stamp to a Date, returning null when it is unparseable (so
 * the caller falls back to its injected clock rather than passing an Invalid
 * Date into markDone). Pure.
 */
function parseIsoToDate(iso: string): Date | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

// ─────────────────────────────────────────────────────────────────────
// The registrar — the ONE wire the main agent calls in index.ts.
// ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe the binder to the cockpit bus so it closes the loop in real time.
 * Call this ONCE in the composition root. Returns the unsubscribe handle (kept
 * for symmetry / test teardown; the gateway holds it for process lifetime).
 *
 * NOTE: the cockpit bus subscribes PER-TENANT (`subscribeCockpitEvents(tenantId,
 * handler)`). The closure binder is tenant-AGNOSTIC (it reads the tenant off the
 * event), so the caller passes the tenant it is subscribing for — typically this
 * is registered per-tenant alongside the cockpit SSE attach. When a single
 * process-wide subscription is wanted instead, prefer wiring `onMwikilaActed`
 * into whatever per-tenant subscribe loop the gateway already runs.
 */
export function subscribeOrgLoopClosure(
  binder: TaskCommitmentBinder,
  tenantId: string,
): () => void {
  return subscribeCockpitEvents(tenantId, (event) => {
    // The bus handler must be synchronous-safe: fire-and-forget the async close,
    // and the binder already contains every fault (never throws), so an unhandled
    // rejection cannot reach the bus.
    void binder.onMwikilaActed(event);
  });
}
