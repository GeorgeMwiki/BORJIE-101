/**
 * DepositToOfftakeOrchestrator — types + contracts.
 *
 * A pure, composition-root-agnostic state machine that stitches together
 * the pre-existing marketplace / waitlist / negotiation / credit-rating /
 * inspection / renewal domain services into the full available-capacity → offtake
 * pipeline.
 *
 * The orchestrator **does not** re-implement any of these services. It
 * asks each one to do a narrowly-scoped unit of work (publish listing,
 * compute credit rating, propose offer, mark capacity committed, etc.) and
 * records the result as a state transition in the `offtake_pipeline_runs`
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
export const OFFTAKE_PIPELINE_STATES = [
  'idle',
  'listed',
  'receiving_inquiries',
  'screening_buyer',
  'offer_extended',
  'offer_signed',
  'mobilisation_scheduled',
  'offtake_active',
  // Branch / terminal states
  'awaiting_approval',
  'rejected',
  'withdrew',
  'expired',
  'cancelled',
] as const;

export type OfftakePipelineState = (typeof OFFTAKE_PIPELINE_STATES)[number];

/**
 * Terminal states — the run ends here and no further auto-advance can run.
 * `offtake_active` is the happy-path terminal; the others are failure branches.
 */
export const TERMINAL_STATES: readonly OfftakePipelineState[] = [
  'offtake_active',
  'rejected',
  'withdrew',
  'expired',
  'cancelled',
];

// ---------------------------------------------------------------------------
// Events — external nudges that drive transitions.
// ---------------------------------------------------------------------------

export type OfftakePipelineEventType =
  | 'StartPipeline'
  | 'ListingPublished'
  | 'InquiryReceived'
  | 'BuyerScreened'
  | 'OfferExtended'
  | 'OfferSigned'
  | 'OfferExpired'
  | 'BuyerWithdrew'
  | 'BuyerRejected'
  | 'MobilisationScheduled'
  | 'OfftakeActivated'
  | 'ApprovalGranted'
  | 'ApprovalDenied'
  | 'Cancelled';

export interface OfftakePipelineEvent {
  readonly type: OfftakePipelineEventType;
  readonly at: string; // ISO timestamp
  readonly actor: string; // userId or 'system'
  readonly reason?: string;
  readonly payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Run record — mirror of the `offtake_pipeline_runs` row.
// ---------------------------------------------------------------------------

export interface OfftakePipelineRun {
  readonly runId: string;
  readonly tenantId: string;
  readonly siteId: string;
  readonly state: OfftakePipelineState;
  readonly listingId: string | null;
  readonly buyerCustomerId: string | null;
  readonly negotiationId: string | null;
  readonly offtakeId: string | null;
  readonly creditRatingScore: number | null;
  /** Append-only audit trail — one entry per state transition. */
  readonly history: readonly OfftakePipelineEvent[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
  readonly cancelledReason: string | null;
  readonly approvalReason: string | null;
}

/** Creation input for a brand-new run. */
export interface StartPipelineInput {
  readonly tenantId: string;
  readonly siteId: string;
  readonly initiatedBy: string;
  readonly correlationId?: string;
  readonly source?: 'manual' | 'capacity_available_event' | 'api';
}

/** Shape persisted to Postgres — maps 1:1 onto the table columns. */
export interface OfftakePipelineRunRow {
  readonly runId: string;
  readonly tenantId: string;
  readonly siteId: string;
  readonly state: OfftakePipelineState;
  readonly listingId: string | null;
  readonly buyerCustomerId: string | null;
  readonly negotiationId: string | null;
  readonly offtakeId: string | null;
  readonly creditRatingScore: number | null;
  readonly historyJson: readonly OfftakePipelineEvent[];
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

export interface OfftakePipelineRunRepository {
  create(run: OfftakePipelineRun): Promise<OfftakePipelineRun>;
  findById(
    tenantId: string,
    runId: string,
  ): Promise<OfftakePipelineRun | null>;
  listBySite(
    tenantId: string,
    siteId: string,
  ): Promise<readonly OfftakePipelineRun[]>;
  update(
    tenantId: string,
    runId: string,
    patch: Partial<Omit<OfftakePipelineRun, 'runId' | 'tenantId' | 'startedAt'>>,
  ): Promise<OfftakePipelineRun>;
}

// ---------------------------------------------------------------------------
// Transition result — returned by state-machine.transition().
// ---------------------------------------------------------------------------

export interface TransitionResult {
  readonly nextState: OfftakePipelineState;
  readonly allowed: boolean;
  readonly reason: string;
  readonly branch?: 'happy' | 'rejected' | 'withdrew' | 'expired' | 'cancelled' | 'approval';
}
