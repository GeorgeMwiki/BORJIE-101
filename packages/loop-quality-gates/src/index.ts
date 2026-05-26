/**
 * `@borjie/loop-quality-gates` — public surface.
 *
 * Wave M3-M4. The Layer 4 (quality gates) primitive of the
 * five-layer loop architecture. Five gates plus an AND-composite:
 *
 *   - groundedness — every factual claim has a resolvable citation
 *   - calibration  — claimed confidence ≈ observed accuracy
 *   - brand        — Mr. Mwikila persona + Borjie token discipline
 *   - authority    — proposed tier ≤ granted tier (and T2-Critical
 *                    routing to double-verify)
 *   - budget       — usd / wall-clock / tool-call axes have headroom
 *
 * Source of truth: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md.
 */

// ── Types ──────────────────────────────────────────────────────────────────
export {
  DEFAULT_SIGNAL_WEIGHT,
  DEFAULT_CALIBRATION_TOLERANCE,
  REQUIRED_PERSONA_NAME,
  REJECTED_BRAND_SUBSTRINGS,
  HEX_COLOR_RE,
  DEFAULT_GATE_CONFIG,
  QualityGateError,
  type GateSignalKind,
  type QualitySignal,
  type QualityGateResult,
  type GateConfig,
  type CompositeGateResult,
} from './types.js';

// ── Gates ──────────────────────────────────────────────────────────────────
export {
  groundednessGate,
  type GroundednessClaim,
  type GroundednessInput,
} from './gates/groundedness-gate.js';

export {
  calibrationGate,
  type CalibrationInput,
  type CalibratorPort,
  type ConfidenceLabel,
} from './gates/calibration-gate.js';

export {
  brandGate,
  type BrandInput,
} from './gates/brand-gate.js';

export {
  authorityGate,
  type AuthorityInput,
  type AuthorityTier,
  type MutationAuthorityPort,
} from './gates/authority-gate.js';

export {
  budgetGate,
  type BudgetAxis,
  type BudgetInput,
} from './gates/budget-gate.js';

// ── Composite ──────────────────────────────────────────────────────────────
export {
  compositeGate,
  type CompositeInput,
  type NamedGateInvocation,
} from './composite/composite-gate.js';
