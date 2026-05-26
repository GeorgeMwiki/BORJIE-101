/**
 * `@borjie/loop-runner` — public surface.
 *
 * Wave M3-M4. The pure five-layer orchestrator of the AI-Native OS.
 * Wires sensors / policy / tools / quality-gates / learning into one
 * disciplined cycle, persists per-layer outcomes + quality signals,
 * short-circuits on gate failure.
 *
 * Source of truth: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md.
 *
 * Companion package: `@borjie/loop-quality-gates`, which supplies the
 * Layer 4 primitives (groundedness, calibration, brand, authority,
 * budget) and the composite combinator the runner invokes.
 */

// ── Types ──────────────────────────────────────────────────────────────────
export {
  LOOP_KINDS,
  LOOP_STATUSES,
  LOOP_LAYERS,
  LoopRunnerError,
  type LoopKind,
  type LoopStatus,
  type LoopLayer,
  type LoopInput,
  type LayerOutcome,
  type SensorsOutcome,
  type PolicyOutcome,
  type ToolsOutcome,
  type LearningOutcome,
  type LoopRunResult,
  type LoopLogger,
  type LoopRunRowInsert,
  type LoopRunRowUpdate,
  type LoopRunRepository,
  type LayerOutcomeRowInsert,
  type LayerOutcomeRepository,
  type QualitySignalRowInsert,
  type QualitySignalRepository,
} from './types.js';

// ── Runner ─────────────────────────────────────────────────────────────────
export {
  runLoop,
  type LoopRunnerDeps,
  type SensorsFn,
  type PolicyFn,
  type ToolsFn,
  type QualityFn,
  type LearnFn,
} from './runner/loop-runner.js';

// ── Repositories ───────────────────────────────────────────────────────────
export { createInMemoryLoopRunRepository } from './repositories/loop-run-repository.js';
export { createInMemoryLayerOutcomeRepository } from './repositories/layer-outcome-repository.js';
export { createInMemoryQualitySignalRepository } from './repositories/quality-signal-repository.js';
