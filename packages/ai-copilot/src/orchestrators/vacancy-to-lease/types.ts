/**
 * VacancyToLeaseOrchestrator — types + contracts.
 *
 * A pure, composition-root-agnostic state machine that stitches together
 * the pre-existing marketplace / waitlist / negotiation / credit-rating /
 * inspection / renewal domain services into the full vacancy → lease
 * pipeline.
 *
 * The orchestrator **does not** re-implement any of these services. It
 * asks each one to do a narrowly-scoped unit of work (publish listing,
 * compute credit rating, propose offer, mark unit filled, etc.) and
 * records the result as a state transition in the `vacancy_pipeline_runs`
 * Postgres table (migration 0098).
 *
 * Wave 27 Phase A agent PhA1.
 */

// ---------------------------------------------------------------------------
// States — the public lifecycle of a run.
// ---------------------------------------------------------------------------

/**
 * All states the orchestrator can be in. The happy path runs left-to-right
 * through the first seven values; `awaiting_approval`, `rejected`,
 * `withdrew`, `expired`, and `cancelled` are branch/terminal states.
 */
export const VACANCY_PIPELINE_STATES = [
  'idle',
  'listed',
  'receiving_inquiries',
  'screening_applicant',
  'offer_extended',
  'offer_signed',
  'move_in_scheduled',
  'lease_active',
  // Branch / terminal states
  'awaiting_approval',
  'rejected',
  'withdrew',
  'expired',
  'cancelled',
] as const;

export type VacancyPipelineState = (typeof VACANCY_PIPELINE_STATES)[number];

/**
 * Terminal states — the run ends here and no further auto-advance can run.
 * `lease_active` is the happy-path terminal; the others are failure branches.
 */
export const TERMINAL_STATES: readonly VacancyPipelineState[] = [
  'lease_active',
  'rejected',
  'withdrew',
  'expired',
  'cancelled',
];

// ---------------------------------------------------------------------------
// Events — external nudges that drive transitions.
// ---------------------------------------------------------------------------

export type VacancyPipelineEventType =
  | 'StartPipeline'
  | 'ListingPublished'
  | 'InquiryReceived'
  | 'ApplicantScreened'
  | 'OfferExtended'
  | 'OfferSigned'
  | 'OfferExpired'
  | 'ApplicantWithdrew'
  | 'ApplicantRejected'
  | 'MoveInScheduled'
  | 'LeaseActivated'
  | 'ApprovalGranted'
  | 'ApprovalDenied'
  | 'Cancelled';

export interface VacancyPipelineEvent {
  readonly type: VacancyPipelineEventType;
  readonly at: string; // ISO timestamp
  readonly actor: string; // userId or 'system'
  readonly reason?: string;
  readonly payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Run record — mirror of the `vacancy_pipeline_runs` row.
// ---------------------------------------------------------------------------

export interface VacancyPipelineRun {
  readonly runId: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly state: VacancyPipelineState;
  readonly listingId: string | null;
  readonly applicantCustomerId: string | null;
  readonly negotiationId: string | null;
  readonly leaseId: string | null;
  readonly creditRatingScore: number | null;
  /** Append-only audit trail — one entry per state transition. */
  readonly history: readonly VacancyPipelineEvent[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
  readonly cancelledReason: string | null;
  readonly approvalReason: string | null;
}

/** Creation input for a brand-new run. */
export interface StartPipelineInput {
  readonly tenantId: string;
  readonly unitId: string;
  readonly initiatedBy: string;
  readonly correlationId?: string;
  readonly source?: 'manual' | 'unit_vacated_event' | 'api';
}

/** Shape persisted to Postgres — maps 1:1 onto the table columns. */
export interface VacancyPipelineRunRow {
  readonly runId: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly state: VacancyPipelineState;
  readonly listingId: string | null;
  readonly applicantCustomerId: string | null;
  readonly negotiationId: string | null;
  readonly leaseId: string | null;
  readonly creditRatingScore: number | null;
  readonly historyJson: readonly VacancyPipelineEvent[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
  readonly cancelledReason: string | null;
  readonly approvalReason: string | null;
}

// ---------------------------------------------------------------------------
// Repository port — persistence contract. The orchestrator-service calls
// these; the api-gateway composition root supplies an in-memory adapter
// for tests and a Postgres-backed adapter for prod.
// ---------------------------------------------------------------------------

export interface VacancyPipelineRunRepository {
  create(run: VacancyPipelineRun): Promise<VacancyPipelineRun>;
  findById(
    tenantId: string,
    runId: string,
  ): Promise<VacancyPipelineRun | null>;
  listByUnit(
    tenantId: string,
    unitId: string,
  ): Promise<readonly VacancyPipelineRun[]>;
  update(
    tenantId: string,
    runId: string,
    patch: Partial<Omit<VacancyPipelineRun, 'runId' | 'tenantId' | 'startedAt'>>,
  ): Promise<VacancyPipelineRun>;
}

// ---------------------------------------------------------------------------
// Transition result — returned by state-machine.transition().
// ---------------------------------------------------------------------------

export interface TransitionResult {
  readonly nextState: VacancyPipelineState;
  readonly allowed: boolean;
  readonly reason: string;
  readonly branch?: 'happy' | 'rejected' | 'withdrew' | 'expired' | 'cancelled' | 'approval';
}
