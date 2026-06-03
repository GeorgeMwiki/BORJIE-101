/**
 * Model-card types — Mitchell et al. 2019 ("Model Cards for Model
 * Reporting", FAT* '19) section structure (LP-22b).
 *
 * Borjie previously shipped only a model-card *coverage auditor*
 * (`scripts/audit-model-card-coverage.mjs`) which checks that a card FILE
 * exists per (model × jurisdiction) — it never rendered the card body. This
 * module is the missing RENDERER: a pure (model record) → Markdown function
 * covering the canonical sections, re-skinned for a mining-estate OS rather
 * than a lending platform.
 *
 * Pure + I/O-free: the renderer takes a fully-resolved `ModelCardRecord` and
 * returns a string. Persistence (writing to `Docs/regulator-pack/<j>/
 * model-cards/`) is the caller's job, mirroring how the coverage auditor
 * already addresses those paths.
 *
 * Validation: `modelCardRecordSchema` (zod) lets callers parse untrusted
 * input (e.g. a registry row) before rendering, per the repo input-validation
 * rule.
 */

import { z } from 'zod';

/** Mitchell §1 — feature provenance for the model. */
export const modelCardFeatureSchema = z.object({
  /** Machine name of the feature. */
  name: z.string().min(1),
  /** Coarse type. */
  type: z.enum(['numeric', 'categorical', 'boolean', 'text', 'embedding']),
  /** Where the value comes from, e.g. `corpus:tra`, `sensor:assay`. */
  source: z.string().min(1),
  /** Whether the feature may be null at inference. */
  nullable: z.boolean(),
  /** Whether the value is PII / tenant-confidential (drives redaction). */
  sensitive: z.boolean(),
});
export type ModelCardFeature = z.infer<typeof modelCardFeatureSchema>;

/** Mitchell §4 — a quantitative-analysis metric. */
export const modelCardMetricSchema = z.object({
  key: z.string().min(1),
  value: z.number(),
  /** Optional unit, e.g. `%`, `ms`, `Brier`. */
  unit: z.string().optional(),
  /** Higher-is-better (default) vs lower-is-better (e.g. Brier, error rate). */
  higherIsBetter: z.boolean().default(true),
});
export type ModelCardMetric = z.infer<typeof modelCardMetricSchema>;

/**
 * Mitchell §5 — a disaggregated (fairness) evaluation slice. The
 * `disparityRatio` is the slice's headline metric relative to the best
 * slice for the same attribute (the four-fifths / 80% analog); `passesGate`
 * is `disparityRatio >= fairnessFloor`.
 */
export const modelCardFairnessSliceSchema = z.object({
  /** Protected/grouping attribute, e.g. `region`, `language`, `cooperative_size`. */
  attribute: z.string().min(1),
  /** Slice label within the attribute, e.g. `geita`, `swahili`. */
  slice: z.string().min(1),
  /** Headline performance for this slice (same metric across slices). */
  metricValue: z.number(),
  /** Population (n) in this slice — context for significance. */
  population: z.number().int().nonnegative(),
  /** Slice metric ÷ best-slice metric for the attribute (0..1+). */
  disparityRatio: z.number().nonnegative(),
});
export type ModelCardFairnessSlice = z.infer<
  typeof modelCardFairnessSliceSchema
>;

/** The full card record. Sections map 1:1 to Mitchell et al. 2019. */
export const modelCardRecordSchema = z.object({
  // §1 Model details
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  /** Owning team / point of contact. */
  owner: z.string().min(1),
  /** ISO date the model was trained. */
  trainedAt: z.string().min(1),
  /** Content hash of the training snapshot (tamper-evidence). */
  trainDatasetHash: z.string().min(1),
  status: z.enum(['champion', 'challenger', 'shadow', 'retired']),

  // §2 Intended use
  intendedUse: z.string().min(1),
  outOfScopeUses: z.array(z.string().min(1)).default([]),

  // §3 Factors / features
  features: z.array(modelCardFeatureSchema).default([]),

  // §4 Metrics
  metrics: z.array(modelCardMetricSchema).default([]),

  // §5 Evaluation data / fairness
  fairnessSlices: z.array(modelCardFairnessSliceSchema).default([]),
  /** Min acceptable disparityRatio. Default 0.8 (four-fifths rule). */
  fairnessFloor: z.number().min(0).max(1).default(0.8),

  // §6 Training data
  trainingDataSummary: z.string().min(1),
  /** Sample size of the training set. */
  trainingSampleSize: z.number().int().nonnegative(),

  // §7 Ethical considerations + §8 Caveats
  ethicalConsiderations: z.array(z.string().min(1)).default([]),
  caveats: z.array(z.string().min(1)).default([]),

  /** Free-form owner notes (rendered last). */
  notes: z.string().optional(),
});
export type ModelCardRecord = z.infer<typeof modelCardRecordSchema>;

/** Result of rendering: the Markdown plus a machine-checkable verdict. */
export interface RenderedModelCard {
  /** The full Markdown body. */
  readonly markdown: string;
  /** True iff every fairness slice meets the floor. */
  readonly fairnessPasses: boolean;
  /** Slices that fall below `fairnessFloor` (the failing rows). */
  readonly failingSlices: ReadonlyArray<ModelCardFairnessSlice>;
}
