/**
 * VacancyToLeaseOrchestrator — state-machine + service tests.
 *
 * Covers:
 *   - Pure transition table: every happy-path edge + representative
 *     branch edges (rejected/withdrew/expired/cancelled).
 *   - Invalid transitions return `allowed=false` with a diagnostic reason.
 *   - Terminal states accept no further events.
 *   - The service layer stitches the transitions into a persisted run,
 *     honours the autonomy policy gate, and emits a PlatformEvent on
 *     every transition.
 *   - `parkAwaitingApproval` lands runs in `awaiting_approval` when the
 *     policy denies an auto-advance with requiresApproval=true.
 */

import { describe, it, expect } from 'vitest';
import {
  isTerminal,
  listAllowedEvents,
  routeToApproval,
  transition,
} from '../state-machine.js';
import {
  InMemoryVacancyPipelineRunRepository,
  VacancyPipelineError,
  VacancyToLeaseOrchestrator,
  type OrchestratorCreditRatingPort,
  type OrchestratorEnquiryPort,
  type OrchestratorEventPort,
  type OrchestratorInspectionPort,
  type OrchestratorListingPort,
  type OrchestratorNegotiationPort,
  type OrchestratorPolicyPort,
  type OrchestratorRenewalPort,
  type OrchestratorWaitlistPort,
} from '../orchestrator-service.js';

// ---------------------------------------------------------------------------
// Pure transition tests
// ---------------------------------------------------------------------------

describe('vacancy-to-lease state machine', () => {
  it('allows the full happy path', () => {
    expect(transition('idle', 'StartPipeline').nextState).toBe('listed');
    expect(transition('listed', 'InquiryReceived').nextState).toBe(
      'receiving_inquiries',
    );
    expect(
      transition('receiving_inquiries', 'ApplicantScreened').nextState,
    ).toBe('screening_applicant');
    expect(
      transition('screening_applicant', 'OfferExtended').nextState,
    ).toBe('offer_extended');
    expect(transition('offer_extended', 'OfferSigned').nextState).toBe(
      'offer_signed',
    );
    expect(
      transition('offer_signed', 'MoveInScheduled').nextState,
    ).toBe('move_in_scheduled');
    expect(
      transition('move_in_scheduled', 'LeaseActivated').nextState,
    ).toBe('lease_active');
  });

  it('rejects unknown transitions with a diagnostic reason', () => {
    const result = transition('idle', 'LeaseActivated');
    expect(result.allowed).toBe(false);
    expect(result.nextState).toBe('idle');
    expect(result.reason).toMatch(/No transition from idle/);
  });

  it('routes to rejected when applicant fails screening', () => {
    const result = transition('screening_applicant', 'ApplicantRejected');
    expect(result.nextState).toBe('rejected');
    expect(result.branch).toBe('rejected');
  });

  it('routes to withdrew when applicant drops mid-offer', () => {
    const result = transition('offer_extended', 'ApplicantWithdrew');
    expect(result.nextState).toBe('withdrew');
    expect(result.branch).toBe('withdrew');
  });

  it('routes to expired when offer window lapses', () => {
    const result = transition('offer_extended', 'OfferExpired');
    expect(result.nextState).toBe('expired');
    expect(result.branch).toBe('expired');
  });

  it('routes to cancelled from any non-terminal state', () => {
    for (const state of ['idle', 'listed', 'receiving_inquiries'] as const) {
      const result = transition(state, 'Cancelled');
      expect(result.allowed).toBe(true);
      expect(result.nextState).toBe('cancelled');
    }
  });

  it('marks lease_active + rejected + expired + withdrew + cancelled as terminal', () => {
    expect(isTerminal('lease_active')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
    expect(isTerminal('withdrew')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('idle')).toBe(false);
    expect(isTerminal('listed')).toBe(false);
  });

  it('listAllowedEvents reflects the outgoing edges', () => {
    expect(listAllowedEvents('offer_extended')).toEqual(
      expect.arrayContaining(['OfferSigned', 'OfferExpired', 'ApplicantWithdrew']),
    );
    expect(listAllowedEvents('lease_active')).toEqual([]);
  });

  it('routeToApproval always lands on awaiting_approval', () => {
    const result = routeToApproval('policy blocked auto-advance');
    expect(result.nextState).toBe('awaiting_approval');
    expect(result.branch).toBe('approval');
  });
});

// ---------------------------------------------------------------------------
// Service-level integration tests — exercise the orchestrator with
// in-memory ports so we get end-to-end coverage without touching Postgres.
// ---------------------------------------------------------------------------

function buildTestOrchestrator(
  overrides: {
    policy?: Partial<OrchestratorPolicyPort>;
    emitted?: Array<Record<string, unknown>>;
  } = {},
): {
  readonly orchestrator: VacancyToLeaseOrchestrator;
  readonly repo: InMemoryVacancyPipelineRunRepository;
  readonly emitted: Array<Record<string, unknown>>;
} {
  const emitted = overrides.emitted ?? [];
  const listing: OrchestratorListingPort = {
    async publishListing() {
      return { listingId: 'lst_test_1' };
    },
  };
  const enquiry: OrchestratorEnquiryPort = {
    async latestApplicant() {
      return { customerId: 'cust_1' };
    },
  };
  const creditRating: OrchestratorCreditRatingPort = {
    async score() {
      return { score: 750 };
    },
  };
  const negotiation: OrchestratorNegotiationPort = {
    async proposeOffer() {
      return { negotiationId: 'neg_1' };
    },
  };
  const inspection: OrchestratorInspectionPort = {
    async scheduleMoveInInspection() {
      return { inspectionId: 'insp_1' };
    },
  };
  const renewal: OrchestratorRenewalPort = {
    async seedFirstTerm() {
      return { leaseId: 'lease_1' };
    },
  };
  const waitlist: OrchestratorWaitlistPort = {
    async markUnitFilled() {
      /* no-op */
    },
  };
  const defaultPolicy: OrchestratorPolicyPort = {
    async isAuthorized() {
      return { authorized: true, requiresApproval: false, reason: 'ok' };
    },
  };
  const policy: OrchestratorPolicyPort = {
    ...defaultPolicy,
    ...overrides.policy,
  };
  const events: OrchestratorEventPort = {
    async emit(e) {
      emitted.push(e as unknown as Record<string, unknown>);
    },
  };
  const repo = new InMemoryVacancyPipelineRunRepository();
  const orchestrator = new VacancyToLeaseOrchestrator({
    repo,
    listing,
    enquiry,
    creditRating,
    negotiation,
    inspection,
    renewal,
    waitlist,
    policy,
    events,
    now: () => '2026-04-20T00:00:00.000Z',
  });
  return { orchestrator, repo, emitted };
}

describe('VacancyToLeaseOrchestrator service', () => {
  it('startPipeline creates a run and advances to listed', async () => {
    const { orchestrator, emitted } = buildTestOrchestrator();
    const run = await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
      source: 'manual',
    });
    expect(run.state).toBe('listed');
    expect(run.listingId).toBe('lst_test_1');
    expect(run.history.length).toBe(2); // StartPipeline event + transition edge
    const emittedTypes = emitted.map((e) => e.eventType);
    expect(emittedTypes).toContain('VacancyPipelineStarted');
    expect(emittedTypes).toContain('VacancyPipeline:listed');
  });

  it('advances through inquiry → screening → offer', async () => {
    const { orchestrator } = buildTestOrchestrator();
    let run = await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
    });
    run = await orchestrator.advance(run, 'InquiryReceived', 'user_admin');
    expect(run.state).toBe('receiving_inquiries');
    expect(run.applicantCustomerId).toBe('cust_1');
    run = await orchestrator.advance(run, 'ApplicantScreened', 'user_admin');
    expect(run.state).toBe('screening_applicant');
    expect(run.creditRatingScore).toBe(750);
    run = await orchestrator.advance(run, 'OfferExtended', 'user_admin');
    expect(run.state).toBe('offer_extended');
    expect(run.negotiationId).toBe('neg_1');
  });

  it('parks in awaiting_approval when autonomy policy requires approval', async () => {
    const { orchestrator } = buildTestOrchestrator({
      policy: {
        async isAuthorized() {
          return {
            authorized: false,
            requiresApproval: true,
            reason: 'Offer letters require review.',
          };
        },
      },
    });
    let run = await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
    });
    // 'listed' itself gates via publish_listing action — the stubbed
    // policy returns requiresApproval=true for every action, so the run
    // should be parked immediately.
    expect(run.state).toBe('awaiting_approval');
    expect(run.approvalReason).toMatch(/require review/i);
  });

  it('rejects when autonomy policy hard-blocks', async () => {
    const { orchestrator } = buildTestOrchestrator({
      policy: {
        async isAuthorized() {
          return {
            authorized: false,
            requiresApproval: false,
            reason: 'Legal block — head sign-off needed.',
          };
        },
      },
    });
    const run = await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
    });
    expect(run.state).toBe('rejected');
    expect(run.cancelledReason).toMatch(/Legal block/);
  });

  it('full happy path ends in lease_active', async () => {
    const { orchestrator } = buildTestOrchestrator();
    let run = await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
    });
    run = await orchestrator.advance(run, 'InquiryReceived', 'user_admin');
    run = await orchestrator.advance(run, 'ApplicantScreened', 'user_admin');
    run = await orchestrator.advance(run, 'OfferExtended', 'user_admin');
    run = await orchestrator.advance(run, 'OfferSigned', 'user_admin');
    run = await orchestrator.advance(run, 'MoveInScheduled', 'user_admin');
    run = await orchestrator.advance(run, 'LeaseActivated', 'user_admin');
    expect(run.state).toBe('lease_active');
    expect(run.endedAt).not.toBeNull();
    expect(run.leaseId).toBe('lease_1');
  });

  it('cancelRun stops a non-terminal run', async () => {
    const { orchestrator } = buildTestOrchestrator();
    const run = await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
    });
    const cancelled = await orchestrator.cancelRun(
      't1',
      run.runId,
      'user_admin',
      'owner pulled unit',
    );
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.cancelledReason).toBe('owner pulled unit');
  });

  it('advance on a terminal run throws TERMINAL', async () => {
    const { orchestrator } = buildTestOrchestrator();
    const run = await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
    });
    const cancelled = await orchestrator.cancelRun(
      't1',
      run.runId,
      'user_admin',
      'reason',
    );
    await expect(
      orchestrator.advance(cancelled, 'InquiryReceived', 'user_admin'),
    ).rejects.toBeInstanceOf(VacancyPipelineError);
  });

  it('listRuns is tenant-scoped', async () => {
    const { orchestrator } = buildTestOrchestrator();
    await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u1',
      initiatedBy: 'user_admin',
    });
    await orchestrator.startPipeline({
      tenantId: 't1',
      unitId: 'u2',
      initiatedBy: 'user_admin',
    });
    const t1u1 = await orchestrator.listRuns('t1', 'u1');
    const t1u2 = await orchestrator.listRuns('t1', 'u2');
    const t2u1 = await orchestrator.listRuns('t2', 'u1');
    expect(t1u1).toHaveLength(1);
    expect(t1u2).toHaveLength(1);
    expect(t2u1).toHaveLength(0);
  });
});
