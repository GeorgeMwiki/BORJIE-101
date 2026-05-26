/**
 * `@borjie/strategic-layer` — public type surface.
 *
 * Wave M10–M12. Mirrors the 6-table schema introduced by migration
 * `0040_strategic_layer.sql`:
 *
 *   - NorthStar             — a row in `north_star_objectives`.
 *   - ObjectiveProgress     — a row in `objective_progress`.
 *   - PivotProposal         — a row in `pivot_proposals`.
 *   - FederationConsent     — a row in `federation_consents`.
 *   - EpsilonBudget         — a row in `epsilon_budgets`.
 *   - EpsilonLedgerEntry    — a row in `epsilon_ledger`.
 *
 * Plus the value enumerations the storage layer enforces and the
 * narrow repository ports the managers depend on.
 *
 * Spec: Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md §15.
 */

// ---------------------------------------------------------------------------
// Value enumerations — match the SQL CHECK constraints in 0040_*.sql
// ---------------------------------------------------------------------------

/** Lifecycle of a `north_star_objectives` row. */
export type ObjectiveStatus =
  | 'proposed'
  | 'active'
  | 'met'
  | 'missed'
  | 'retired';

/** Lifecycle of a `pivot_proposals` row. */
export type PivotStatus = 'open' | 'accepted' | 'rejected' | 'expired';

/** Scope of a `federation_consents` row. */
export type ConsentScope =
  | 'patterns'
  | 'rules'
  | 'terminology'
  | 'failures'
  | 'all';

/** Lifecycle of a `federation_consents` row. */
export type ConsentStatus = 'active' | 'revoked' | 'expired';

/** Drift-signal tri-state computed by ProgressTracker.driftSignal(). */
export type DriftSignal = 'on_track' | 'at_risk' | 'off_track';

/** Pivot-shape recommendation embedded in PivotProposal.evidence. */
export type PivotShape = 'retarget' | 'reframe' | 'retire_and_replace';

// ---------------------------------------------------------------------------
// NorthStar — durable goal record
// ---------------------------------------------------------------------------

export interface NorthStar {
  readonly id: string;
  readonly tenantId: string;
  /** 'tenant_root' or org_unit_id (Wave 18Y org-scope). */
  readonly scopeId: string;
  readonly title: string;
  readonly description: string;
  /** e.g. 'royalty_revenue_tzs', 'fx_position_usd'. */
  readonly metricName: string;
  readonly targetValue: number;
  /** ISO-8601 timestamp. */
  readonly targetAt: string;
  readonly status: ObjectiveStatus;
  readonly ownerUserId: string;
  /** ISO-8601 timestamp. */
  readonly createdAt: string;
  /** ISO-8601 timestamp. */
  readonly updatedAt: string;
  readonly auditHash: string;
  readonly prevHash: string | null;
}

export interface CreateNorthStarInput {
  readonly tenantId: string;
  readonly scopeId: string;
  readonly title: string;
  readonly description: string;
  readonly metricName: string;
  readonly targetValue: number;
  readonly targetAt: string;
  readonly ownerUserId: string;
}

// ---------------------------------------------------------------------------
// ObjectiveProgress — append-only observation log entry
// ---------------------------------------------------------------------------

export interface ObjectiveProgress {
  readonly id: string;
  readonly objectiveId: string;
  readonly tenantId: string;
  /** ISO-8601 timestamp. */
  readonly recordedAt: string;
  readonly observedValue: number;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly auditHash: string;
}

export interface ObserveProgressInput {
  readonly tenantId: string;
  readonly objectiveId: string;
  readonly observedValue: number;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// PivotProposal
// ---------------------------------------------------------------------------

export interface PivotProposal {
  readonly id: string;
  readonly objectiveId: string;
  readonly tenantId: string;
  /** ISO-8601 timestamp. */
  readonly proposedAt: string;
  readonly rationale: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly status: PivotStatus;
  readonly decidedBy: string | null;
  /** ISO-8601 timestamp. */
  readonly decidedAt: string | null;
  readonly auditHash: string;
}

export interface ProposePivotInput {
  readonly tenantId: string;
  readonly objectiveId: string;
  readonly rationale: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// FederationConsent
// ---------------------------------------------------------------------------

export interface FederationConsent {
  readonly tenantId: string;
  readonly scope: ConsentScope;
  /** ISO-8601 timestamp. */
  readonly grantedAt: string;
  /** ISO-8601 timestamp. */
  readonly expiresAt: string;
  readonly grantedBy: string;
  readonly status: ConsentStatus;
  /** ISO-8601 timestamp. */
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly auditHash: string;
}

export interface GrantConsentInput {
  readonly tenantId: string;
  readonly scope: ConsentScope;
  readonly durationDays: number;
  readonly grantedBy: string;
}

// ---------------------------------------------------------------------------
// EpsilonBudget + EpsilonLedgerEntry
// ---------------------------------------------------------------------------

export interface EpsilonBudget {
  readonly tenantId: string;
  /** YYYY-MM-01 — the first day of the monthly period. */
  readonly periodStart: string;
  readonly totalEpsilon: number;
  readonly spentEpsilon: number;
  /** ISO-8601 timestamp. */
  readonly createdAt: string;
  /** ISO-8601 timestamp. */
  readonly updatedAt: string;
  readonly auditHash: string;
}

export interface InitialiseBudgetInput {
  readonly tenantId: string;
  /** YYYY-MM-01 — the first day of the monthly period. */
  readonly periodStart: string;
  readonly totalEpsilon: number;
}

export interface EpsilonLedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  /** YYYY-MM-01 — the first day of the monthly period. */
  readonly periodStart: string;
  readonly chargeEpsilon: number;
  readonly opKind: string;
  readonly opId: string;
  /** ISO-8601 timestamp. */
  readonly recordedAt: string;
  readonly auditHash: string;
}

export interface ChargeBudgetInput {
  readonly tenantId: string;
  /** YYYY-MM-01 — the first day of the monthly period. */
  readonly periodStart: string;
  readonly chargeEpsilon: number;
  readonly opKind: string;
  readonly opId: string;
}

export interface ChargeBudgetResult {
  readonly remaining: number;
  readonly entry: EpsilonLedgerEntry;
}

// ---------------------------------------------------------------------------
// Repository ports — narrow, swappable persistence
// ---------------------------------------------------------------------------

export interface NorthStarObjectivesRepository {
  insert(row: NorthStar): Promise<NorthStar>;
  findById(tenantId: string, id: string): Promise<NorthStar | null>;
  updateStatus(
    tenantId: string,
    id: string,
    status: ObjectiveStatus,
    updatedAt: string,
    auditHash: string,
    prevHash: string,
  ): Promise<NorthStar>;
  listActive(tenantId: string): Promise<ReadonlyArray<NorthStar>>;
}

export interface ObjectiveProgressRepository {
  insert(row: ObjectiveProgress): Promise<ObjectiveProgress>;
  listForObjective(
    tenantId: string,
    objectiveId: string,
    limit: number,
  ): Promise<ReadonlyArray<ObjectiveProgress>>;
  latest(
    tenantId: string,
    objectiveId: string,
  ): Promise<ObjectiveProgress | null>;
}

export interface PivotProposalsRepository {
  insert(row: PivotProposal): Promise<PivotProposal>;
  findById(tenantId: string, id: string): Promise<PivotProposal | null>;
  updateStatus(
    tenantId: string,
    id: string,
    status: PivotStatus,
    decidedBy: string | null,
    decidedAt: string | null,
    auditHash: string,
  ): Promise<PivotProposal>;
  latestOpenForObjective(
    tenantId: string,
    objectiveId: string,
  ): Promise<PivotProposal | null>;
}

export interface FederationConsentsRepository {
  upsert(row: FederationConsent): Promise<FederationConsent>;
  find(
    tenantId: string,
    scope: ConsentScope,
  ): Promise<FederationConsent | null>;
  list(tenantId: string): Promise<ReadonlyArray<FederationConsent>>;
}

export interface EpsilonBudgetsRepository {
  insert(row: EpsilonBudget): Promise<EpsilonBudget>;
  find(
    tenantId: string,
    periodStart: string,
  ): Promise<EpsilonBudget | null>;
  applyCharge(
    tenantId: string,
    periodStart: string,
    delta: number,
    updatedAt: string,
    auditHash: string,
  ): Promise<EpsilonBudget>;
}

export interface EpsilonLedgerRepository {
  insert(row: EpsilonLedgerEntry): Promise<EpsilonLedgerEntry>;
  findByIdempotencyKey(
    tenantId: string,
    opKind: string,
    opId: string,
  ): Promise<EpsilonLedgerEntry | null>;
}

// ---------------------------------------------------------------------------
// Logger port — production wires @borjie/observability createLogger;
// dev/test wires a no-op or console-shim.
// ---------------------------------------------------------------------------

export interface StrategicLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
}

/**
 * Telemetry-config shape mirrored from `@borjie/observability` so the
 * package stays I/O-free while remaining wire-compatible. Production
 * binds `createLogger(telemetry)`; tests supply the no-op factory.
 */
export interface StrategicTelemetryConfig {
  readonly service: {
    readonly name: string;
    readonly version: string;
    readonly environment: string;
    readonly instanceId?: string;
  };
  readonly enabled: boolean;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly traceSampleRatio: number;
  readonly metricsIntervalMs: number;
  readonly consoleExport?: boolean;
  readonly redactFields?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StrategicLayerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly meta?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'StrategicLayerError';
  }
}

export class EpsilonBudgetExhausted extends StrategicLayerError {
  constructor(
    public readonly tenantId: string,
    public readonly periodStart: string,
    public readonly attemptedCharge: number,
    public readonly remaining: number,
  ) {
    super(
      `ε-budget exhausted: tenant=${tenantId} period=${periodStart} ` +
        `attempted=${attemptedCharge} remaining=${remaining}`,
      'EPSILON_BUDGET_EXHAUSTED',
      { tenantId, periodStart, attemptedCharge, remaining },
    );
    this.name = 'EpsilonBudgetExhausted';
  }
}

export class ConsentDenied extends StrategicLayerError {
  constructor(
    public readonly tenantId: string,
    public readonly scope: ConsentScope,
  ) {
    super(
      `Federation consent denied: tenant=${tenantId} scope=${scope}`,
      'CONSENT_DENIED',
      { tenantId, scope },
    );
    this.name = 'ConsentDenied';
  }
}

export class InvalidStateTransition extends StrategicLayerError {
  constructor(
    public readonly currentStatus: string,
    public readonly attemptedStatus: string,
  ) {
    super(
      `Invalid state transition: ${currentStatus} → ${attemptedStatus}`,
      'INVALID_STATE_TRANSITION',
      { currentStatus, attemptedStatus },
    );
    this.name = 'InvalidStateTransition';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STRATEGIC_CONSTANTS = Object.freeze({
  /** Default α for Rényi-DP composition — Mironov 2017 default. */
  RENYI_ALPHA: 4,
  /** Default δ for (ε,δ)-DP conversion — typical 10^-6. */
  RENYI_DELTA: 1e-6,
  /** Max consent duration before re-grant required. */
  MAX_CONSENT_DAYS: 365,
  /** Drift threshold: at-risk if projected ≤ targetAt × this factor. */
  DRIFT_AT_RISK_FACTOR: 1.15,
  /** Pivot proposal expires open status after N days. */
  PIVOT_EXPIRY_DAYS: 30,
  /** Drift must persist this many days before a pivot can be proposed. */
  PIVOT_TRIGGER_OFF_TRACK_DAYS: 7,
  /** Pivot cool-down after rejection (days). */
  PIVOT_COOLDOWN_AFTER_REJECT_DAYS: 14,
} as const);
