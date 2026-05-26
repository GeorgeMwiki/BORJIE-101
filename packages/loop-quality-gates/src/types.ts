/**
 * `@borjie/loop-quality-gates` — public type surface (Wave M3-M4).
 *
 * Companion to Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §3.4.
 * Defines the contracts that every Layer 4 quality gate honours:
 *
 *   - `QualitySignal`     : the per-gate emitted record (signal name,
 *                           score in [0,1], weight, evidence payload).
 *   - `QualityGateResult` : the result a gate returns (pass + signal +
 *                           reason text).
 *   - `GateConfig`        : per-gate tunable knobs surfaced as a single
 *                           configuration object so the composite gate
 *                           can be wired with all knobs in one place.
 *
 * All types are `readonly` to satisfy the project's immutability rule
 * (~/.claude/rules/coding-style.md). Construction helpers in sibling
 * modules always return fresh objects.
 */

// ---------------------------------------------------------------------------
// Tunables (overridable via GateConfig)
// ---------------------------------------------------------------------------

/** Default weight applied to every signal in the AND-composite. */
export const DEFAULT_SIGNAL_WEIGHT = 1.0;

/** Calibration acceptable absolute gap: |claimed - observed| ≤ this. */
export const DEFAULT_CALIBRATION_TOLERANCE = 0.2;

/** Brand gate: required persona name (visible-name discipline). */
export const REQUIRED_PERSONA_NAME = 'Mr. Mwikila';

/** Brand gate: rejected literal substrings (case-insensitive). */
export const REJECTED_BRAND_SUBSTRINGS: ReadonlyArray<string> = Object.freeze([
  'i am an ai',
  'i am the bot',
  'i am chatgpt',
  'as a language model',
  'as an ai',
]);

/** Brand gate: regex that catches a 3-, 4-, 6-, or 8-digit hex literal. */
export const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/;

// ---------------------------------------------------------------------------
// Signal kinds
// ---------------------------------------------------------------------------

/** Canonical set of gate signals. Extend via the `signal` string field. */
export type GateSignalKind =
  | 'groundedness'
  | 'calibration'
  | 'brand'
  | 'authority'
  | 'budget';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface QualitySignal {
  /** Canonical signal name (extensible string — gate authors pick). */
  readonly signal: string;
  /** Pass=1.0, hard-fail=0.0, partial-fail in between. */
  readonly score: number;
  /** Composite weight. Default 1.0. Non-negative. */
  readonly weight: number;
  /** Gate-specific evidence payload (failed claim ids, observed values…). */
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface QualityGateResult {
  /** Overall pass — must be `true` for the loop to enter Layer 5. */
  readonly pass: boolean;
  /** Single signal this gate emitted. */
  readonly signal: QualitySignal;
  /** Human-readable reason string. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GateConfig {
  /** Acceptable absolute gap for the calibration gate. */
  readonly calibrationTolerance: number;
  /** Persona name the brand gate requires in user-facing text. */
  readonly requiredPersonaName: string;
  /** Brand gate: case-insensitive rejected substrings. */
  readonly rejectedBrandSubstrings: ReadonlyArray<string>;
  /** Authority gate: tier ceiling. Outputs above this are rejected. */
  readonly maxAuthorityTier: 0 | 1 | 2;
  /** Budget gate: minimum remaining cents required to pass. */
  readonly minRemainingBudgetCents: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = Object.freeze({
  calibrationTolerance: DEFAULT_CALIBRATION_TOLERANCE,
  requiredPersonaName: REQUIRED_PERSONA_NAME,
  rejectedBrandSubstrings: REJECTED_BRAND_SUBSTRINGS,
  maxAuthorityTier: 1,
  minRemainingBudgetCents: 0,
});

// ---------------------------------------------------------------------------
// Composite shape
// ---------------------------------------------------------------------------

export interface CompositeGateResult {
  /** Overall pass — logical AND across all gate results. */
  readonly pass: boolean;
  /** All signals emitted (both passing and failing). */
  readonly signals: ReadonlyArray<QualitySignal>;
  /** Names of gates that emitted a fail (pass=false). */
  readonly failedGates: ReadonlyArray<string>;
  /** Concatenated human-readable reasons for the failed gates. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class QualityGateError extends Error {
  public readonly code: 'INVALID_INPUT' | 'INTERNAL';
  constructor(message: string, code: 'INVALID_INPUT' | 'INTERNAL') {
    super(message);
    this.name = 'QualityGateError';
    this.code = code;
  }
}
