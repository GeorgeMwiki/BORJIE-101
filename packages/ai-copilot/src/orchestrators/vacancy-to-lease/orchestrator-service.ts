/**
 * VacancyToLeaseOrchestrator — service layer.
 *
 * Drives a persisted run through the state machine, calling into each
 * domain service (marketplace.listing, marketplace.enquiry, negotiation,
 * credit-rating, waitlist.vacancyHandler, renewal) as the active state
 * requires. Every transition:
 *
 *   1. Consults `AutonomyPolicyService.isAuthorized(...)` for the domain
 *      action it is about to take.
 *   2. If authorized → invokes the domain service, updates the run row,
 *      emits a `PlatformEvent` so the process-miner + audit trail +
 *      downstream subscribers all see it.
 *   3. If approval required → routes the run into `awaiting_approval`
 *      (the state machine still records the edge in history).
 *   4. If blocked outright → marks the run `rejected` with reason.
 *
 * The service is composition-agnostic: it depends only on ports, not on
 * concrete Postgres/HTTP adapters. The api-gateway composition root is
 * responsible for wiring the Postgres-backed repository in; in-memory
 * adapters are provided for tests.
 */

import {
  isTerminal,
  routeToApproval,
  transition,
} from './state-machine.js';
import type {
  StartPipelineInput,
  TransitionResult,
  VacancyPipelineEvent,
  VacancyPipelineEventType,
  VacancyPipelineRun,
  VacancyPipelineRunRepository,
  VacancyPipelineState,
} from './types.js';

// ---------------------------------------------------------------------------
// Orchestration ports — narrow facades over the real domain services so
// tests don't need to spin up the whole domain. Every method mirrors a
// concrete call site on the real service (see `orchestratePhase*` below).
// ---------------------------------------------------------------------------

export interface OrchestratorListingPort {
  publishListing(
    tenantId: string,
    unitId: string,
    initiatedBy: string,
    correlationId: string,
  ): Promise<{ readonly listingId: string }>;
}

export interface OrchestratorEnquiryPort {
  latestApplicant(
    tenantId: string,
    listingId: string,
  ): Promise<{ readonly customerId: string } | null>;
}

export interface OrchestratorCreditRatingPort {
  score(tenantId: string, customerId: string): Promise<{ readonly score: number }>;
}

export interface OrchestratorNegotiationPort {
  proposeOffer(
    tenantId: string,
    listingId: string,
    customerId: string,
    initiatedBy: string,
  ): Promise<{ readonly negotiationId: string }>;
}

export interface OrchestratorInspectionPort {
  scheduleMoveInInspection(
    tenantId: string,
    unitId: string,
    customerId: string,
  ): Promise<{ readonly inspectionId: string | null }>;
}

export interface OrchestratorRenewalPort {
  seedFirstTerm(
    tenantId: string,
    unitId: string,
    customerId: string,
  ): Promise<{ readonly leaseId: string | null }>;
}

export interface OrchestratorWaitlistPort {
  markUnitFilled(
    tenantId: string,
    unitId: string,
  ): Promise<void>;
}

export interface OrchestratorPolicyPort {
  /**
   * Narrow facade over AutonomyPolicyService.isAuthorized. Returns a
   * structurally identical decision shape so the orchestrator can treat
   * autonomy as a pluggable check — useful in tests.
   */
  isAuthorized(
    tenantId: string,
    action: string,
    context?: Record<string, unknown>,
  ): Promise<{
    readonly authorized: boolean;
    readonly requiresApproval: boolean;
    readonly reason: string;
  }>;
}

export interface OrchestratorEventPort {
  /** Emit a `PlatformEvent` so process-miner + audit trail pick it up. */
  emit(event: {
    readonly eventType: string;
    readonly tenantId: string;
    readonly runId: string;
    readonly unitId: string;
    readonly state: VacancyPipelineState;
    readonly payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface VacancyToLeaseOrchestratorDeps {
  readonly repo: VacancyPipelineRunRepository;
  readonly listing: OrchestratorListingPort;
  readonly enquiry: OrchestratorEnquiryPort;
  readonly creditRating: OrchestratorCreditRatingPort;
  readonly negotiation: OrchestratorNegotiationPort;
  readonly inspection: OrchestratorInspectionPort;
  readonly renewal: OrchestratorRenewalPort;
  readonly waitlist: OrchestratorWaitlistPort;
  readonly policy: OrchestratorPolicyPort;
  readonly events: OrchestratorEventPort;
  readonly now?: () => string;
  readonly idGenerator?: () => string;
  /** Minimum credit score to auto-advance past screening. */
  readonly creditRatingAutoApproveMin?: number;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultId(): string {
  // Lightweight prefix + random hex, no external dep. Safe for non-
  // cryptographic use (the runId is audit-keyed by tenantId anyway).
  const rand = Math.random().toString(16).slice(2, 10);
  const ts = Date.now().toString(36);
  return `vpr_${ts}_${rand}`;
}

export class VacancyToLeaseOrchestrator {
  private readonly deps: VacancyToLeaseOrchestratorDeps;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly creditRatingAutoApproveMin: number;

  constructor(deps: VacancyToLeaseOrchestratorDeps) {
    this.deps = deps;
    this.now = deps.now ?? defaultNow;
    this.idGenerator = deps.idGenerator ?? defaultId;
    // Consistent with AutonomyPolicy.leasing.autoApproveApplicationScoreMin
    // (FICO-scale). A cautious default rejects anything below 620.
    this.creditRatingAutoApproveMin = deps.creditRatingAutoApproveMin ?? 620;
  }

  // -------------------------------------------------------------------------
  // Public API — invoked from the `/vacancy-pipeline` router.
  // -------------------------------------------------------------------------

  /**
   * Begin a new pipeline for a vacant unit. Creates an `idle` run, then
   * immediately attempts to auto-advance into `listed` by calling
   * marketplace.listing.publish().
   */
  async startPipeline(input: StartPipelineInput): Promise<VacancyPipelineRun> {
    const correlationId = input.correlationId ?? `vpr_corr_${Date.now()}`;
    const runId = this.idGenerator();
    const startedAt = this.now();
    const initialEvent: VacancyPipelineEvent = {
      type: 'StartPipeline',
      at: startedAt,
      actor: input.initiatedBy,
      payload: { source: input.source ?? 'manual', correlationId },
    };

    const baseRun: VacancyPipelineRun = {
      runId,
      tenantId: input.tenantId,
      unitId: input.unitId,
      state: 'idle',
      listingId: null,
      applicantCustomerId: null,
      negotiationId: null,
      leaseId: null,
      creditRatingScore: null,
      history: [initialEvent],
      startedAt,
      updatedAt: startedAt,
      endedAt: null,
      cancelledReason: null,
      approvalReason: null,
    };
    const saved = await this.deps.repo.create(baseRun);

    await this.deps.events.emit({
      eventType: 'VacancyPipelineStarted',
      tenantId: input.tenantId,
      runId: saved.runId,
      unitId: saved.unitId,
      state: saved.state,
      payload: { source: input.source ?? 'manual', correlationId },
    });

    // First transition — try to publish the listing autonomously.
    return this.advance(saved, 'StartPipeline', input.initiatedBy, {
      correlationId,
    });
  }

  /**
   * Manually nudge a run to the next event. Used by the admin/override
   * endpoint and by event subscribers that want to drive the pipeline
   * from a concrete signal (e.g. `OfferSigned` when the tenant
   * countersigns via the customer app).
   */
  async advance(
    run: VacancyPipelineRun,
    event: VacancyPipelineEventType,
    actor: string,
    context: Record<string, unknown> = {},
  ): Promise<VacancyPipelineRun> {
    if (isTerminal(run.state)) {
      // Surface the same shape the caller expects so the router can
      // return a helpful 409 instead of 500.
      throw new VacancyPipelineError(
        `Run ${run.runId} is terminal (${run.state}); cannot advance.`,
        'TERMINAL',
      );
    }

    const result = transition(run.state, event);
    if (!result.allowed) {
      throw new VacancyPipelineError(
        `Event ${event} is not valid from state ${run.state}.`,
        'INVALID_TRANSITION',
      );
    }

    // Autonomy check keyed to the action we are about to perform.
    const action = autonomyActionFor(result.nextState);
    let gatingDecision: TransitionResult = result;
    if (action) {
      const decision = await this.deps.policy.isAuthorized(
        run.tenantId,
        action,
        context,
      );
      if (!decision.authorized) {
        if (decision.requiresApproval) {
          return this.parkAwaitingApproval(run, event, actor, decision.reason);
        }
        // Hard-block — terminate as rejected.
        return this.recordTransition(run, {
          event,
          actor,
          result: {
            nextState: 'rejected',
            allowed: true,
            reason: decision.reason,
            branch: 'rejected',
          },
          merge: { cancelledReason: decision.reason },
        });
      }
    }

    // Execute the domain call that corresponds to the next state.
    try {
      const effect = await this.performSideEffect(run, result.nextState, actor, context);
      return this.recordTransition(run, {
        event,
        actor,
        result: gatingDecision,
        merge: effect,
      });
    } catch (err) {
      // Follow-up WAVE-28+ (Docs/TODO_BACKLOG.md): richer error classification — retry vs fail.
      throw new VacancyPipelineError(
        err instanceof Error ? err.message : String(err),
        'SIDE_EFFECT_FAILED',
      );
    }
  }

  /** Fetch a single run by id (tenant-scoped). */
  async getRun(
    tenantId: string,
    runId: string,
  ): Promise<VacancyPipelineRun | null> {
    return this.deps.repo.findById(tenantId, runId);
  }

  /** List every run (any state) attached to a unit. */
  async listRuns(
    tenantId: string,
    unitId: string,
  ): Promise<readonly VacancyPipelineRun[]> {
    return this.deps.repo.listByUnit(tenantId, unitId);
  }

  /** Explicit cancel — caller-initiated shutdown. */
  async cancelRun(
    tenantId: string,
    runId: string,
    actor: string,
    reason: string,
  ): Promise<VacancyPipelineRun> {
    const run = await this.deps.repo.findById(tenantId, runId);
    if (!run) {
      throw new VacancyPipelineError(`Run ${runId} not found.`, 'NOT_FOUND');
    }
    if (isTerminal(run.state)) return run;
    const cancelEvent: VacancyPipelineEvent = {
      type: 'Cancelled',
      at: this.now(),
      actor,
      reason,
    };
    const updated = await this.deps.repo.update(tenantId, runId, {
      state: 'cancelled',
      history: [...run.history, cancelEvent],
      updatedAt: cancelEvent.at,
      endedAt: cancelEvent.at,
      cancelledReason: reason,
    });
    await this.deps.events.emit({
      eventType: 'VacancyPipelineCancelled',
      tenantId,
      runId,
      unitId: run.unitId,
      state: 'cancelled',
      payload: { reason, actor },
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Internal — side-effect dispatch keyed on the target state.
  // -------------------------------------------------------------------------

  private async performSideEffect(
    run: VacancyPipelineRun,
    nextState: VacancyPipelineState,
    actor: string,
    context: Record<string, unknown>,
  ): Promise<Partial<VacancyPipelineRun>> {
    switch (nextState) {
      case 'listed': {
        const correlationId =
          (context.correlationId as string | undefined) ?? `vpr_${run.runId}`;
        const { listingId } = await this.deps.listing.publishListing(
          run.tenantId,
          run.unitId,
          actor,
          correlationId,
        );
        return { listingId };
      }
      case 'receiving_inquiries': {
        if (!run.listingId) {
          throw new VacancyPipelineError(
            'Cannot process inquiries without a listingId.',
            'MISSING_LISTING',
          );
        }
        const applicant = await this.deps.enquiry.latestApplicant(
          run.tenantId,
          run.listingId,
        );
        return applicant
          ? { applicantCustomerId: applicant.customerId }
          : {};
      }
      case 'screening_applicant': {
        if (!run.applicantCustomerId) return {};
        const { score } = await this.deps.creditRating.score(
          run.tenantId,
          run.applicantCustomerId,
        );
        return { creditRatingScore: score };
      }
      case 'offer_extended': {
        if (!run.listingId || !run.applicantCustomerId) {
          throw new VacancyPipelineError(
            'Cannot extend offer without listing + applicant.',
            'MISSING_PRECONDITION',
          );
        }
        const { negotiationId } = await this.deps.negotiation.proposeOffer(
          run.tenantId,
          run.listingId,
          run.applicantCustomerId,
          actor,
        );
        return { negotiationId };
      }
      case 'offer_signed': {
        // Downstream signal — no autonomous side-effect; transition is
        // driven by the customer app countersigning.
        return {};
      }
      case 'move_in_scheduled': {
        if (!run.applicantCustomerId) return {};
        await this.deps.inspection.scheduleMoveInInspection(
          run.tenantId,
          run.unitId,
          run.applicantCustomerId,
        );
        // Renewal first-term setup — returns the newly-minted leaseId
        // so downstream callers can pivot to the real lease.
        const { leaseId } = await this.deps.renewal.seedFirstTerm(
          run.tenantId,
          run.unitId,
          run.applicantCustomerId,
        );
        return leaseId ? { leaseId } : {};
      }
      case 'lease_active': {
        await this.deps.waitlist.markUnitFilled(run.tenantId, run.unitId);
        return { endedAt: this.now() };
      }
      default:
        return {};
    }
  }

  private async parkAwaitingApproval(
    run: VacancyPipelineRun,
    event: VacancyPipelineEventType,
    actor: string,
    reason: string,
  ): Promise<VacancyPipelineRun> {
    const parked = routeToApproval(reason);
    return this.recordTransition(run, {
      event,
      actor,
      result: parked,
      merge: { approvalReason: reason },
    });
  }

  private async recordTransition(
    run: VacancyPipelineRun,
    input: {
      readonly event: VacancyPipelineEventType;
      readonly actor: string;
      readonly result: TransitionResult;
      readonly merge: Partial<VacancyPipelineRun>;
    },
  ): Promise<VacancyPipelineRun> {
    const now = this.now();
    const edge: VacancyPipelineEvent = {
      type: input.event,
      at: now,
      actor: input.actor,
      reason: input.result.reason,
    };
    const nextHistory = [...run.history, edge];
    const terminal = isTerminal(input.result.nextState);
    const updated = await this.deps.repo.update(run.tenantId, run.runId, {
      state: input.result.nextState,
      history: nextHistory,
      updatedAt: now,
      endedAt: terminal ? now : run.endedAt,
      ...input.merge,
    });
    await this.deps.events.emit({
      eventType: `VacancyPipeline:${input.result.nextState}`,
      tenantId: run.tenantId,
      runId: run.runId,
      unitId: run.unitId,
      state: input.result.nextState,
      payload: {
        from: run.state,
        via: input.event,
        branch: input.result.branch,
        reason: input.result.reason,
      },
    });
    return updated;
  }
}

/**
 * Map a target state onto the autonomy-policy action that gates it.
 * Returning `null` means the transition is unilateral (no policy check).
 */
function autonomyActionFor(state: VacancyPipelineState): string | null {
  switch (state) {
    case 'listed':
      return 'publish_listing'; // custom leasing action (future)
    case 'screening_applicant':
      return 'approve_application';
    case 'offer_extended':
      return 'send_offer_letter';
    case 'lease_active':
      return 'approve_renewal'; // reuse — conservative leasing action
    default:
      return null;
  }
}

export type VacancyPipelineErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'TERMINAL'
  | 'MISSING_LISTING'
  | 'MISSING_PRECONDITION'
  | 'SIDE_EFFECT_FAILED';

export class VacancyPipelineError extends Error {
  public readonly code: VacancyPipelineErrorCode;
  constructor(message: string, code: VacancyPipelineErrorCode) {
    super(message);
    this.name = 'VacancyPipelineError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// In-memory repository adapter — used by tests AND by the router when
// the api-gateway is running in degraded mode (DATABASE_URL unset).
// ---------------------------------------------------------------------------

export class InMemoryVacancyPipelineRunRepository
  implements VacancyPipelineRunRepository
{
  private readonly store = new Map<string, VacancyPipelineRun>();

  async create(run: VacancyPipelineRun): Promise<VacancyPipelineRun> {
    this.store.set(keyOf(run.tenantId, run.runId), run);
    return run;
  }

  async findById(
    tenantId: string,
    runId: string,
  ): Promise<VacancyPipelineRun | null> {
    return this.store.get(keyOf(tenantId, runId)) ?? null;
  }

  async listByUnit(
    tenantId: string,
    unitId: string,
  ): Promise<readonly VacancyPipelineRun[]> {
    const out: VacancyPipelineRun[] = [];
    for (const run of this.store.values()) {
      if (run.tenantId === tenantId && run.unitId === unitId) out.push(run);
    }
    return out;
  }

  async update(
    tenantId: string,
    runId: string,
    patch: Partial<Omit<VacancyPipelineRun, 'runId' | 'tenantId' | 'startedAt'>>,
  ): Promise<VacancyPipelineRun> {
    const existing = this.store.get(keyOf(tenantId, runId));
    if (!existing) {
      throw new VacancyPipelineError(
        `Run ${runId} not found for tenant ${tenantId}.`,
        'NOT_FOUND',
      );
    }
    const updated: VacancyPipelineRun = { ...existing, ...patch };
    this.store.set(keyOf(tenantId, runId), updated);
    return updated;
  }
}

function keyOf(tenantId: string, runId: string): string {
  return `${tenantId}::${runId}`;
}
