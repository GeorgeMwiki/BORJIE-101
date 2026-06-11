/**
 * org-loop-types.ts — the SPINE's declarative DATA + pure helpers.
 *
 * Split out of `org-loop-orchestrator.ts` to honour the file-size rule (each
 * unit <800 lines). This module holds:
 *   - the spine's identity constants (LoopSpec id, cron name, kill-switch);
 *   - the injected-port + outcome TYPES (structural — no concrete-impl import);
 *   - the PURE helpers the engine folds (strategy→need, risk preview, the
 *     run-view + strategy_json projections, the delegation predicate);
 *   - the loop-economy `LoopSpec` factory (LOOP-FLEXIBILITY LAW: the engine is
 *     universal, the mining content is data).
 *
 * Everything here is import-light + side-effect-free; the orchestrator wires
 * these over the injected G0-G3 ports. No `console.*` (Pino-shim at the seam).
 */

import {
  loopEconomy,
  type estateMind as estateMindNs,
} from '@borjie/central-intelligence';
import {
  planAssignment,
  type MatchNeed,
  type ScoredCandidate,
} from '@borjie/workforce-orchestrator';
import type {
  AdvanceOrgLoopRunInput,
  MdCommitment,
  MdCommitmentRepository,
  OrgLoopRun,
  OrgLoopRunRepository,
} from '@borjie/database/repositories';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import type {
  CompetenceDomain,
  DriveContext,
  StrategizePort,
  StrategyTrace,
} from './strategize-port.js';
import type { TaskDispatchPort, TaskDispatchResult } from './task-dispatch-port.js';
import type { GapBriefingPort, OrgLoopRunView } from './gap-briefing-port.js';

type EstateProposal = estateMindNs.EstateProposal;
type LoopSpec = loopEconomy.LoopSpec;

// ─────────────────────────────────────────────────────────────────────
// Identity constants — the spine's place in the loop economy + cadence bounds.
// ─────────────────────────────────────────────────────────────────────

/** The loop-economy LoopSpec id (also the default `org_loop_runs.loop_kind`). */
export const ORG_LOOP_SPEC_ID = 'gap_to_delegate';
/** Human title surfaced in the loop registry + boot log. */
export const ORG_LOOP_SPEC_TITLE = 'Gap → delegate (self-running-org spine)';
/** The cluster-leader cron name index.ts wraps this supervisor with. */
export const ORG_LOOP_CRON_NAME = 'org-loop';
/** DEFAULT-ON kill-switch (only off/0/false/no disables). */
export const ORG_LOOP_KILL_SWITCH_ENV = 'BORJIE_ORG_LOOP';

export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 min sweep cadence
const MIN_INTERVAL_MS = 60 * 1000; // 1-minute floor
const MAX_INTERVAL_MS = 60 * 60 * 1000; // 1-hour ceiling
/** Hard cap on tenants swept per tick (DB-read bound). */
export const DEFAULT_MAX_TENANTS_PER_TICK = 200;
/** Hard cap on commitments threaded per tenant per tick. */
export const DEFAULT_MAX_COMMITMENTS_PER_TENANT = 50;

/** The MD's stable system user id — assignments are "assigned by" the MD. */
export const MD_SYSTEM_USER_ID = 'mwikila';

export function clampInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));
}

export function killSwitchOff(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const v = (env[ORG_LOOP_KILL_SWITCH_ENV] ?? '').trim().toLowerCase();
  return v === 'off' || v === '0' || v === 'false' || v === 'no';
}

export function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─────────────────────────────────────────────────────────────────────
// Injected port shapes — structural so the spine shares NO concrete-impl
// import with the other lanes (G1/G2/G3 hand it their factory outputs).
// ─────────────────────────────────────────────────────────────────────

/** The DB-backed person matcher (G2) — best-first candidate ranking. */
export interface PersonMatcherPort {
  match(tenantId: string, need: MatchNeed): Promise<ScoredCandidate[]>;
}

/** The gated propose-only HITL membrane (estate-mind-wiring proposal sink). */
export interface ProposalSinkPort {
  propose(proposal: EstateProposal): Promise<boolean>;
}

/** The cockpit event bus seam (publish-only). */
export interface CockpitPublisher {
  publish(event: unknown): void;
}

/** A cockpit event the spine emits when a run advances (forensic + UI feed). */
export interface OrgLoopCockpitEvent {
  readonly kind: 'mwikila.acted';
  readonly tenantId: string;
  readonly actionKind: 'mining.org_loop.advance';
  readonly summary: string;
}

/** The reduced active-tenant discovery the sweep uses. */
export type ListActiveTenantIds = () => Promise<ReadonlyArray<string>>;

export interface CreateOrgLoopOrchestratorDeps {
  /** The living-MD commitment substrate (read + close-back). */
  readonly commitmentRepo: MdCommitmentRepository;
  /** The durable spine correlation identity (G0). */
  readonly runRepo: OrgLoopRunRepository;
  /** STRATEGIZE port (G3). */
  readonly strategist: StrategizePort;
  /** PICK port (G2). */
  readonly personMatcher: PersonMatcherPort;
  /** ACT/DISPATCH port (G1 keystone over the lit WorkforceDeps). */
  readonly dispatcher: TaskDispatchPort;
  /** OWNER-BRIEFING port (G3). */
  readonly briefer: GapBriefingPort;
  /** The gated propose-only HITL membrane. */
  readonly proposalSink: ProposalSinkPort;
  /** The cockpit feed (publish-only). Optional — omitted in pure tests. */
  readonly cockpit?: CockpitPublisher | null;
  /** Active-tenant discovery for the sweep. Null → zero tenants → no-op ticks. */
  readonly listActiveTenantIds: ListActiveTenantIds | null;
  /** Owner locale for the brief copy (single-language). Default 'en'. */
  readonly ownerLocale?: 'en' | 'sw';
  readonly logger?: PinoLikeLogger;
  readonly intervalMs?: number;
  readonly maxTenantsPerTick?: number;
  readonly maxCommitmentsPerTenant?: number;
  /** Test override; default: on unless NODE_ENV=test or kill-switch off. */
  readonly enabled?: boolean;
  /** Injected wall clock (a Date). Default: real clock. */
  readonly clock?: () => Date;
  /** Injected uuid (reserved for parity; unused by the thread today). */
  readonly uuid?: () => string;
  /** Env source (bootstrap-injected); defaults to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

// ─────────────────────────────────────────────────────────────────────
// Outcome shapes — what one `onCommitmentDue` / `tickOnce` resolves to.
// ─────────────────────────────────────────────────────────────────────

/** How one commitment's spine thread resolved. */
export type OrgLoopThreadOutcome =
  | { readonly kind: 'skipped'; readonly reason: string }
  | {
      /** A HIGH/sovereign assignment surfaced for owner approval (not executed). */
      readonly kind: 'proposed_for_approval';
      readonly runId: string;
      readonly chosenEmployeeId: string;
    }
  | {
      /** Dispatched + delivered + owner-briefed (the happy path). */
      readonly kind: 'dispatched';
      readonly runId: string;
      readonly taskId: string;
      readonly chosenEmployeeId: string;
    }
  | {
      readonly kind: 'failed';
      readonly runId: string | null;
      readonly reason: string;
    };

export interface OrgLoopTickResult {
  readonly tenantsScanned: number;
  readonly commitmentsThreaded: number;
  readonly dispatched: number;
  readonly proposedForApproval: number;
  readonly skipped: number;
  readonly failed: number;
}

/** How one owner DISMISS of a parked run resolved. */
export type OrgLoopDismissOutcome =
  | { readonly kind: 'dismissed'; readonly runId: string }
  | { readonly kind: 'skipped'; readonly reason: string };

// ─────────────────────────────────────────────────────────────────────
// HITL approval — machine-readable reason tokens + the parked predicate.
// Tokens (not prose) so the route can map them to HTTP statuses and the
// client renders its own single-language copy (no EN leaking into SW).
// ─────────────────────────────────────────────────────────────────────

/** threadCommitment skip reason: the run is parked awaiting the owner. */
export const SKIP_REASON_AWAITING_APPROVAL = 'awaiting_approval';
/** Approval-consumer skip reason: no open run with that id in this tenant. */
export const RESUME_REASON_RUN_NOT_FOUND = 'run_not_found';
/** Approval-consumer skip reason: the run is not parked at the HITL gate. */
export const RESUME_REASON_NOT_AWAITING_APPROVAL = 'not_awaiting_approval';

/**
 * A run PARKED at the HITL gate: stage 'report', status 'open', a chosen
 * employee recorded, and NO taskId yet (the owner has not decided). The
 * sweep SKIPS these (never re-threads / re-proposes — the nag-storm kill)
 * and only the approval consumer (approve / dismiss) moves them forward.
 */
export function isAwaitingApproval(run: OrgLoopRun): boolean {
  return (
    run.stage === 'report' &&
    run.status === 'open' &&
    run.chosenEmployeeId !== null &&
    run.taskId === null
  );
}

export interface OrgLoopOrchestrator {
  /** The chat/event fast-path: thread ONE commitment through the spine. */
  onCommitmentDue(
    tenantId: string,
    commitment: MdCommitment,
    driveContext?: DriveContext,
  ): Promise<OrgLoopThreadOutcome>;
  /**
   * The HITL approval consumer (owner APPROVE): resume a run parked at the
   * 'report' stage and execute the dispatch leg for the already-chosen
   * employee. Never throws — faults resolve to a 'failed' outcome.
   */
  resumeApprovedRun(
    tenantId: string,
    runId: string,
  ): Promise<OrgLoopThreadOutcome>;
  /**
   * The HITL approval consumer (owner DISMISS): close a parked run
   * (status 'closed', stage 'reloop') with a dismissal note. Never throws.
   */
  dismissParkedRun(
    tenantId: string,
    runId: string,
    note: string,
  ): Promise<OrgLoopDismissOutcome>;
  /** Run one sweep across active tenants immediately (tests + manual). */
  tickOnce(): Promise<OrgLoopTickResult>;
  /** Leader-gated start (ClusterCronSupervisor-compatible). */
  start(): void;
  stop(): void;
  /** The loop-economy LoopSpec this spine registers as (origin='builtin'). */
  readonly loopSpec: LoopSpec;
  readonly intervalMs: number;
  readonly enabled: boolean;
}

export const ZERO_TICK: OrgLoopTickResult = Object.freeze({
  tenantsScanned: 0,
  commitmentsThreaded: 0,
  dispatched: 0,
  proposedForApproval: 0,
  skipped: 0,
  failed: 0,
});

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — domain-pack DATA mapping (the engine never branches per
// vertical; it folds these pure maps over the injected ports).
// ─────────────────────────────────────────────────────────────────────

/** Map a STRATEGIZE trace → the matcher NEED (competence drives the rank). */
export function strategyToMatchNeed(trace: StrategyTrace): MatchNeed {
  return Object.freeze({
    competenceDomain: trace.taskShape.competenceDomain,
  });
}

/**
 * Preview the risk tier the assignment WILL derive — so the HITL guard can
 * gate BEFORE dispatch. `planAssignment` is pure; it derives the SAME tier
 * `assignTask` would, from the title/description/priority. A HIGH or SOVEREIGN
 * tier means propose-only (owner approval), never auto-execute.
 */
export function previewRequiresApproval(trace: StrategyTrace): boolean {
  try {
    const plan = planAssignment({
      title: trace.taskShape.title,
      description: trace.taskShape.description,
      priority: trace.taskShape.priority,
    });
    return plan.hitlRequired;
  } catch {
    // A malformed shape is treated conservatively as needing approval (never
    // silently auto-dispatched).
    return true;
  }
}

/** A run's `strategy_json` projection (the brief + audit read this subset). */
export function strategyJsonOf(trace: StrategyTrace): Record<string, unknown> {
  return {
    title: trace.taskShape.title,
    competenceDomain: trace.taskShape.competenceDomain,
    priority: trace.taskShape.priority,
    urgency: trace.urgency,
    rationale: trace.rationale,
    source: trace.source,
  };
}

/**
 * Build the OWNER-BRIEFING view from the run + trace + chosen candidate. The
 * matcher's reasons are EN tokens (kernel-authored) — they are surfaced under
 * the EN locale only, so a non-EN brief simply OMITS the reason clause (the
 * briefer never falls back to the other locale's tokens; single-language by
 * construction).
 */
export function toRunView(args: {
  readonly run: OrgLoopRun;
  readonly trace: StrategyTrace;
  readonly candidate: ScoredCandidate;
  readonly competenceDomain: CompetenceDomain;
  readonly driveId: string | null;
  readonly gapKind: string | null;
  readonly proposedAtMs: number;
}): OrgLoopRunView {
  const { run, trace, candidate, competenceDomain, driveId, gapKind } = args;
  const reasons = candidate.reasons.filter((r) => r.trim().length > 0);
  return Object.freeze({
    tenantId: run.tenantId,
    commitmentId: run.commitmentId,
    driveId,
    gapKind,
    competenceDomain,
    strategy: Object.freeze({
      title: trace.taskShape.title,
      competenceDomain,
      priority: trace.taskShape.priority,
      urgency: trace.urgency,
      rationale: trace.rationale,
    }),
    chosenEmployee: Object.freeze({
      employeeId: candidate.employeeId,
      matchConfidence: candidate.confidence,
      // The key is OMITTED entirely (not set to undefined) when no reasons.
      ...(reasons.length > 0 ? { matchReasons: { en: reasons } } : {}),
    }),
    evidenceIds: trace.evidenceIds,
    proposedAtMs: args.proposedAtMs,
  });
}

/**
 * The dispatch trace the ACT stage feeds the G1 dispatcher. PURE. Threads
 * the strategist's URGENCY band and the originating commitment's SOVEREIGN
 * flag so the dispatcher derives an honest risk hint (critical→HIGH,
 * sovereign→SOVEREIGN) instead of a hard-coded 'LOW'.
 */
export function toDispatchTrace(args: {
  readonly tenantId: string;
  readonly chosenEmployeeId: string;
  readonly trace: StrategyTrace;
  readonly commitmentId: string;
  /** The originating commitment's sovereign flag (drives the risk hint). */
  readonly sovereign?: boolean;
}): import('./task-dispatch-port.js').StrategyTrace {
  const { tenantId, chosenEmployeeId, trace, commitmentId } = args;
  return {
    tenantId,
    assignedByUserId: MD_SYSTEM_USER_ID,
    chosenEmployeeId,
    taskShape: {
      title: trace.taskShape.title,
      description: trace.taskShape.description,
      priority: trace.taskShape.priority,
      competenceDomain: trace.taskShape.competenceDomain,
    },
    urgency: trace.urgency,
    ...(args.sovereign !== undefined ? { sovereign: args.sovereign } : {}),
    evidenceIds: [...trace.evidenceIds],
    commitmentId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// The LoopSpec — the spine's declarative identity in the loop economy.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the loop-economy `LoopSpec` (origin='builtin') the spine registers as,
 * so it COMPOSES with the loop-economy substrate (LOOP-FLEXIBILITY LAW). It is
 * a `tick` loop on the spine cadence; it declares NO organ bindings and an
 * actPort the host resolves to THIS orchestrator's sweep (the substrate stays
 * pure — the spec carries no callable).
 */
export function createOrgLoopLoopSpec(args: {
  readonly createdAtMs: number;
  readonly everyMs: number;
}): LoopSpec {
  return loopEconomy.defineLoopSpec({
    id: ORG_LOOP_SPEC_ID,
    title: ORG_LOOP_SPEC_TITLE,
    trigger: { kind: 'tick', everyMs: clampInterval(args.everyMs) },
    organBindings: [],
    actPort: 'org_loop.sweep',
    learnPort: 'org_loop.matcher_learn',
    autonomyTier: 'T1',
    createdAtMs: args.createdAtMs,
    origin: 'builtin',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Delegation predicate — which live commitments the sweep threads. Pure +
// exported so the test + the sweep share one truth. DATA, not engine: a
// commitment is "needing delegation" when it is an actionable open/overdue/
// reopened concern (listLive already excludes gap rows + terminal statuses).
// ─────────────────────────────────────────────────────────────────────

const DELEGATABLE_STATUSES: ReadonlySet<MdCommitment['status']> = new Set([
  'open',
  'overdue',
  'reopened',
]);

export function needsDelegation(commitment: MdCommitment): boolean {
  return DELEGATABLE_STATUSES.has(commitment.status);
}

// Re-export the shared types the orchestrator + tests both consume so a single
// import path (`./org-loop-types.js`) covers the lane's contract.
export type {
  AdvanceOrgLoopRunInput,
  MdCommitment,
  OrgLoopRun,
  StrategyTrace,
  TaskDispatchResult,
};
