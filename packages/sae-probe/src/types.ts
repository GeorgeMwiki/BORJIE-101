/**
 * SAE Probe — public type surface (Wave 18BB-gap, research-grade).
 *
 * Companion to `Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md` §4.
 * Records here describe a *runtime* probe: forward inference of a
 * trained feature dictionary over a hidden-state activation vector.
 *
 * Out-of-scope for this wave: training the SAE itself (GPU work,
 * Phase 2). In-scope: the contract + the persistence + the
 * threshold policy. A placeholder dictionary lives in
 * `probe/feature-detector.ts` so the package compiles and the
 * contract is exercisable in tests.
 *
 * The seven feature categories tracked are:
 *   - deception           — model suppressing internal disagreement
 *   - hallucination       — confabulated fact about a tenant entity
 *   - bias                — disparate-impact-style reasoning leak
 *   - sycophancy          — surface agreement masking disagreement
 *   - prompt_injection    — adversarial input recognition
 *   - self_reference      — model talking about its own role
 *   - confidentiality_leak— about to emit cross-tenant data
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Feature categories
// ---------------------------------------------------------------------------

export const SAE_FEATURE_CATEGORIES = [
  'deception',
  'hallucination',
  'bias',
  'sycophancy',
  'prompt_injection',
  'self_reference',
  'confidentiality_leak',
] as const;

export type SaeFeatureCategory = (typeof SAE_FEATURE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Feature dictionary entry — what the runtime probe consumes
// ---------------------------------------------------------------------------

/**
 * One trained SAE feature. The `direction` is the unit-norm vector
 * in activation space that fires for the concept. The `bias` shifts
 * the firing point. `threshold` is the activation strength above
 * which we record a firing.
 *
 * Phase 2 will replace these with values learned from real activation
 * capture; this package only stipulates the shape.
 */
export interface SaeFeatureDictionaryEntry {
  readonly feature_id: string;
  readonly category: SaeFeatureCategory;
  readonly label: string;
  readonly direction: ReadonlyArray<number>;
  readonly bias: number;
  readonly threshold: number;
}

export type ActivationVector = ReadonlyArray<number>;

// ---------------------------------------------------------------------------
// Runtime firing
// ---------------------------------------------------------------------------

/**
 * Result of running the dictionary forward over a single activation
 * vector. One entry per fired feature. The probe is **read-only**:
 * it never modifies the model and never reacts on its own — reaction
 * is governance's job (see `@borjie/autonomy-governance`).
 */
export interface SaeProbeFiring {
  readonly id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly turn_id: string;
  readonly feature_id: string;
  readonly feature_label: string;
  readonly category: SaeFeatureCategory;
  readonly activation_strength: number;
  readonly threshold_at_time: number;
  readonly detected_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Operation contexts
// ---------------------------------------------------------------------------

export interface ProbeContext {
  readonly tenant_id: string;
  readonly session_id: string;
  readonly turn_id: string;
  readonly now: () => Date;
}

// ---------------------------------------------------------------------------
// Repository + audit ports
// ---------------------------------------------------------------------------

export interface ProbeFeatureRepository {
  insert(firing: SaeProbeFiring): Promise<void>;
  /**
   * Lookup of firings for analytics — anchored to `(tenant_id,
   * feature_id)` with a half-open detected_at window.
   */
  findFirings(
    tenant_id: string,
    feature_id: string,
    from: string,
    to: string,
  ): Promise<ReadonlyArray<SaeProbeFiring>>;
}

export interface AuditChainPort {
  append(payload: {
    readonly tenant_id: string;
    readonly event_kind: string;
    readonly entity_id: string;
    readonly recorded_at: string;
    readonly payload_digest: string;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Threshold policy
// ---------------------------------------------------------------------------

export interface ThresholdOverride {
  readonly feature_id: string;
  readonly tenant_id: string;
  readonly threshold: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SaeProbeErrorCode =
  | 'MISSING_TENANT'
  | 'DIMENSION_MISMATCH'
  | 'EMPTY_DICTIONARY'
  | 'INVALID_INPUT'
  | 'INVALID_THRESHOLD';

export class SaeProbeError extends Error {
  public readonly code: SaeProbeErrorCode;

  public constructor(message: string, code: SaeProbeErrorCode) {
    super(message);
    this.name = 'SaeProbeError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — for host-layer validation of dictionary uploads
// ---------------------------------------------------------------------------

export const saeFeatureCategorySchema = z.enum(SAE_FEATURE_CATEGORIES);

export const saeFeatureDictionaryEntrySchema = z.object({
  feature_id: z.string().min(1),
  category: saeFeatureCategorySchema,
  label: z.string().min(1),
  direction: z.array(z.number()).min(1),
  bias: z.number(),
  threshold: z.number().min(0).max(100),
});
