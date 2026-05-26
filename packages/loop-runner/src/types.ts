/**
 * `@borjie/loop-runner` — public type surface (Wave M3-M4).
 *
 * Companion to Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md.
 * Defines the contracts the runner enforces between layers:
 *
 *   - `LoopInput`         : the runtime envelope the caller passes in
 *                           (kind, tenant_id, started_at, prev_hash).
 *   - `LayerOutcome`      : one row per executed layer
 *                           (sensors / policy / tools / quality / learning).
 *   - `LoopRunResult`     : aggregate result of one run.
 *   - Port interfaces     : Logger, repositories.
 *
 * All types are `readonly` (project immutability rule).
 */

import type {
  CompositeGateResult,
  QualitySignal,
} from '@borjie/loop-quality-gates';

// ---------------------------------------------------------------------------
// Loop kinds + status
// ---------------------------------------------------------------------------

export const LOOP_KINDS = [
  'reactive',
  'tab_tick',
  'deep_research',
  'autonomous_24_7',
  'recipe_lifecycle',
] as const;

export type LoopKind = (typeof LOOP_KINDS)[number];

export const LOOP_STATUSES = [
  'running',
  'ok',
  'no_input',
  'denied',
  'gated',
  'tool_error',
  'quality_failed',
  'learning_error',
] as const;

export type LoopStatus = (typeof LOOP_STATUSES)[number];

export const LOOP_LAYERS = [
  'sensors',
  'policy',
  'tools',
  'quality',
  'learning',
] as const;

export type LoopLayer = (typeof LOOP_LAYERS)[number];

// ---------------------------------------------------------------------------
// LoopInput — what the caller passes in
// ---------------------------------------------------------------------------

export interface LoopInput {
  readonly id: string;
  readonly tenantId: string;
  readonly loopKind: LoopKind | string;
  readonly startedAt: string;
  /** Pointer to the previous loop_run's audit_hash for this tenant. */
  readonly prevHash: string | null;
  /** Caller-supplied envelope (user_id, session_id, subject, etc.). */
  readonly envelope: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Layer outcomes
// ---------------------------------------------------------------------------

export interface LayerOutcome {
  readonly layer: LoopLayer;
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly latencyMs: number;
  readonly costUsdCents: number;
  readonly auditHash: string;
}

export interface SensorsOutcome {
  readonly items: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Optional cost contribution (e.g. external-feed adapter cost). */
  readonly costUsdCents?: number;
}

export interface PolicyOutcome {
  readonly decision: 'allow' | 'deny' | 'gate';
  /** Set when decision === 'gate'. */
  readonly gateName?: string;
  readonly reason: string;
}

export interface ToolsOutcome {
  readonly status: 'ok' | 'error';
  readonly artifacts: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly costUsdCents: number;
  readonly error?: string;
}

export interface LearningOutcome {
  readonly skillUpdates: number;
  readonly memoryUpdates: number;
  readonly calibrationUpdates: number;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// LoopRunResult — what the runner returns
// ---------------------------------------------------------------------------

export interface LoopRunResult {
  readonly loopRunId: string;
  readonly status: LoopStatus;
  readonly endedAt: string;
  readonly layerOutcomes: ReadonlyArray<LayerOutcome>;
  readonly qualitySignals: ReadonlyArray<QualitySignal>;
  readonly totalLatencyMs: number;
  readonly totalCostUsdCents: number;
  readonly auditHash: string;
  /** Set when status='quality_failed'. */
  readonly qualityResult?: CompositeGateResult;
  /** Free-form summary used for telemetry + logs. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface LoopLogger {
  readonly info: (message: string, attrs?: Record<string, unknown>) => void;
  readonly warn: (message: string, attrs?: Record<string, unknown>) => void;
  readonly error: (message: string, attrs?: Record<string, unknown>) => void;
}

export interface LoopRunRowInsert {
  readonly id: string;
  readonly tenantId: string;
  readonly loopKind: string;
  readonly startedAt: string;
  readonly status: LoopStatus;
  readonly auditHash: string;
  readonly prevHash: string | null;
}

export interface LoopRunRowUpdate {
  readonly id: string;
  readonly status: LoopStatus;
  readonly endedAt: string;
  readonly auditHash: string;
}

export interface LoopRunRepository {
  readonly insert: (row: LoopRunRowInsert) => Promise<void>;
  readonly update: (row: LoopRunRowUpdate) => Promise<void>;
  readonly find: (id: string) => Promise<LoopRunRowInsert | null>;
}

export interface LayerOutcomeRowInsert {
  readonly id: string;
  readonly loopRunId: string;
  readonly tenantId: string;
  readonly layer: LoopLayer;
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly latencyMs: number;
  readonly costUsdCents: number;
  readonly auditHash: string;
}

export interface LayerOutcomeRepository {
  readonly insert: (row: LayerOutcomeRowInsert) => Promise<void>;
  readonly listForRun: (
    loopRunId: string,
  ) => Promise<ReadonlyArray<LayerOutcomeRowInsert>>;
}

export interface QualitySignalRowInsert {
  readonly id: string;
  readonly loopRunId: string;
  readonly tenantId: string;
  readonly signal: string;
  readonly score: number;
  readonly weight: number;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface QualitySignalRepository {
  readonly insert: (row: QualitySignalRowInsert) => Promise<void>;
  readonly listForRun: (
    loopRunId: string,
  ) => Promise<ReadonlyArray<QualitySignalRowInsert>>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LoopRunnerError extends Error {
  public readonly code: 'INVALID_INPUT' | 'INTERNAL' | 'LAYER_ERROR';
  constructor(
    message: string,
    code: 'INVALID_INPUT' | 'INTERNAL' | 'LAYER_ERROR',
  ) {
    super(message);
    this.name = 'LoopRunnerError';
    this.code = code;
  }
}
