/**
 * Piece O — Need-Detection types & Zod schemas.
 *
 * Every value crossing a boundary (DB row in, observer payload in,
 * proposal out) goes through one of these schemas. Pure data only —
 * no IO, no clocks, no randomness.
 *
 * Schemas mirror migrations 0261-0265 with one caveat: the DB stores
 * numerics as strings via pg's NUMERIC, so the runtime schemas accept
 * both `number` and `string` and coerce in `aggregator.ts`.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// Module template ids — soft TEXT pointers. Canonical labels are kept
// as a const tuple so the scoring matrix + tests stay aligned. New
// modules are added by extending this tuple and the matrix; no
// migration required.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Canonical module template ids. Soft enum — the DB column is TEXT,
 * but downstream consumers (UX banner, install flow) read from this
 * set when they can. Unknown ids are tolerated (the matrix uses TEXT
 * keys throughout) — they just won't have a default mapping.
 */
export const MODULE_TEMPLATE_IDS = [
  'COMPLIANCE',
  'LEGAL',
  'HR',
  'PROCUREMENT',
  'FLEET',
  'STRATEGY',
] as const;

export const moduleTemplateIdSchema = z.string().min(1).max(64);
export type ModuleTemplateId = z.infer<typeof moduleTemplateIdSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Signal kinds — mirrors the TEXT enum in 0261.
// ─────────────────────────────────────────────────────────────────────────

export const signalKindSchema = z.enum([
  'search_keyword',
  'conversation_intent',
  'doc_upload',
  'tab_event_pattern',
  'external_trigger',
]);
export type SignalKind = z.infer<typeof signalKindSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Signal payload shapes (one per kind).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Search keyword payload — the raw query plus extracted lowercase tokens
 * that the matrix can pattern-match against.
 */
export const searchKeywordPayloadSchema = z.object({
  query: z.string().min(1).max(512),
  tokens: z.array(z.string()).max(50),
});
export type SearchKeywordPayload = z.infer<typeof searchKeywordPayloadSchema>;

/**
 * Conversation intent payload — NER entities + a top-level intent label.
 * Entities are `[entityType, surfaceForm]` pairs; only entityType is
 * matched against the matrix.
 */
export const conversationIntentPayloadSchema = z.object({
  messageId: z.string().min(1).max(128),
  intent: z.string().max(64).optional(),
  entities: z
    .array(
      z.tuple([z.string().min(1).max(64), z.string().min(1).max(256)]),
    )
    .max(100),
});
export type ConversationIntentPayload = z.infer<
  typeof conversationIntentPayloadSchema
>;

/**
 * Document upload payload — doc_type is the classifier output from
 * Piece K's extraction pipeline.
 */
export const docUploadPayloadSchema = z.object({
  documentId: z.string().min(1).max(128),
  docType: z.string().min(1).max(64),
  confidence: z.number().min(0).max(1).optional(),
});
export type DocUploadPayload = z.infer<typeof docUploadPayloadSchema>;

/**
 * Tab event pattern payload — emitted by Piece L's tab event log scanner
 * when a behavioural pattern fires (e.g. repeated finance visits w/ no
 * action). The `pattern` string is the canonical pattern id; `detail` is
 * free-form forensic data.
 */
export const tabEventPatternPayloadSchema = z.object({
  pattern: z.string().min(1).max(64),
  occurrences: z.number().int().nonnegative(),
  detail: z.record(z.unknown()).optional(),
});
export type TabEventPatternPayload = z.infer<
  typeof tabEventPatternPayloadSchema
>;

/**
 * External trigger payload — a generic webhook/connector emission. The
 * `source` identifies the connector ('kra', 'm-pesa-webhook', …) and
 * `kind` is the connector-defined event name.
 */
export const externalTriggerPayloadSchema = z.object({
  source: z.string().min(1).max(64),
  kind: z.string().min(1).max(64),
  data: z.record(z.unknown()).optional(),
});
export type ExternalTriggerPayload = z.infer<typeof externalTriggerPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Signal row — mirrors migration 0261 columns.
// ─────────────────────────────────────────────────────────────────────────

export const signalRowSchema = z.object({
  id: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  signalKind: signalKindSchema,
  signalPayload: z.record(z.unknown()),
  suggestedModuleTemplateId: moduleTemplateIdSchema.nullable(),
  weight: z.number().min(0).max(99.99),
  createdAt: z.date(),
});
export type SignalRow = z.infer<typeof signalRowSchema>;

/**
 * Input for the observer-side `emitSignal` API. The id is generated
 * by the writer, not the caller, so callers pass everything else.
 */
export const newSignalInputSchema = signalRowSchema
  .omit({ id: true, createdAt: true })
  .extend({ id: z.string().min(1).max(128).optional() });
export type NewSignalInput = z.infer<typeof newSignalInputSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Proposal row — mirrors migration 0262.
// ─────────────────────────────────────────────────────────────────────────

export const proposalStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'expired',
  'snoozed',
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const proposalRowSchema = z.object({
  id: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  suggestedModuleTemplateId: moduleTemplateIdSchema,
  score: z.number().min(0).max(999.99),
  topSignalIds: z.array(z.string().min(1).max(128)).max(20),
  proposalMessage: z.string().min(1).max(1024),
  status: proposalStatusSchema,
  decidedAt: z.date().nullable(),
  createdAt: z.date(),
  expiresAt: z.date(),
});
export type ProposalRow = z.infer<typeof proposalRowSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Personalization row — mirrors migration 0263.
// ─────────────────────────────────────────────────────────────────────────

export const densityPreferenceSchema = z.enum([
  'compact',
  'comfortable',
  'spacious',
]);
export type DensityPreference = z.infer<typeof densityPreferenceSchema>;

export const personalizationRowSchema = z.object({
  id: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  moduleId: z.string().min(1).max(128).nullable(),
  sectionOrder: z.array(z.string().min(1).max(128)),
  hiddenSectionIds: z.array(z.string().min(1).max(128)),
  densityPreference: densityPreferenceSchema,
  masteryLevel: z.number().int().min(0).max(100),
  customProps: z.record(z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type PersonalizationRow = z.infer<typeof personalizationRowSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Layout override row — mirrors migration 0264.
// ─────────────────────────────────────────────────────────────────────────

export const overrideKindSchema = z.enum(['visibility', 'position', 'props']);
export type OverrideKind = z.infer<typeof overrideKindSchema>;

export const layoutOverrideRowSchema = z.object({
  id: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128).nullable(),
  sectionId: z.string().min(1).max(128),
  overrideKind: overrideKindSchema,
  override: z.record(z.unknown()),
  priority: z.number().int().min(-32768).max(32767),
  createdAt: z.date(),
});
export type LayoutOverrideRow = z.infer<typeof layoutOverrideRowSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Detector state — mirrors migration 0265.
// ─────────────────────────────────────────────────────────────────────────

export const detectorStateConfigSchema = z.object({
  scoreThreshold: z.number().min(0).max(999).optional(),
  declineSnoozeDays: z.number().int().min(0).max(365).optional(),
  proposalExpiryDays: z.number().int().min(1).max(365).optional(),
  signalHalfLifeDays: z.number().min(0.1).max(365).optional(),
  lookbackDays: z.number().int().min(1).max(365).optional(),
  scanIntervalHours: z.number().int().min(1).max(168).optional(),
});
export type DetectorStateConfig = z.infer<typeof detectorStateConfigSchema>;

export const detectorStateRowSchema = z.object({
  tenantId: z.string().min(1).max(128),
  lastScanAt: z.date(),
  totalSignalsScanned: z.number().int().nonnegative(),
  totalProposalsEmitted: z.number().int().nonnegative(),
  config: detectorStateConfigSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DetectorStateRow = z.infer<typeof detectorStateRowSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Aggregation output — what aggregator hands to emitter.
// ─────────────────────────────────────────────────────────────────────────

/**
 * One entry per (user, suggested_module_template) pair the aggregator
 * found above zero. Sorted by score desc by the aggregator.
 */
export interface AggregatedScore {
  readonly tenantId: string;
  readonly userId: string;
  readonly suggestedModuleTemplateId: ModuleTemplateId;
  readonly score: number;
  readonly contributingSignalIds: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Personalization output — what engine returns.
// ─────────────────────────────────────────────────────────────────────────

export interface PersonalizationDecision {
  readonly userId: string;
  readonly moduleId: string | null;
  readonly sectionOrder: readonly string[];
  readonly hiddenSectionIds: readonly string[];
  readonly densityPreference: DensityPreference;
  readonly masteryLevel: number;
  readonly rationale: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Convenience exports — barrel-friendly.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fully-resolved detector config. All fields required (no undefined) so
 * downstream code (cron, aggregator, emitter) doesn't have to defend
 * against `undefined`. Mirrors the shape of `DetectorStateConfig` but
 * with every key concrete.
 */
export interface ResolvedDetectorConfig {
  readonly scoreThreshold: number;
  readonly declineSnoozeDays: number;
  readonly proposalExpiryDays: number;
  readonly signalHalfLifeDays: number;
  readonly lookbackDays: number;
  readonly scanIntervalHours: number;
}

/** Default detector config — used when DB row is empty / has no overrides. */
export const DEFAULT_DETECTOR_CONFIG: ResolvedDetectorConfig = Object.freeze({
  scoreThreshold: 5.0,
  declineSnoozeDays: 30,
  proposalExpiryDays: 14,
  signalHalfLifeDays: 7,
  lookbackDays: 14,
  scanIntervalHours: 6,
});

/**
 * Merge a partial DB config with defaults. Pure.
 */
export function resolveDetectorConfig(
  partial: DetectorStateConfig | undefined,
): ResolvedDetectorConfig {
  if (!partial) return DEFAULT_DETECTOR_CONFIG;
  return Object.freeze({
    scoreThreshold:
      partial.scoreThreshold ?? DEFAULT_DETECTOR_CONFIG.scoreThreshold,
    declineSnoozeDays:
      partial.declineSnoozeDays ?? DEFAULT_DETECTOR_CONFIG.declineSnoozeDays,
    proposalExpiryDays:
      partial.proposalExpiryDays ?? DEFAULT_DETECTOR_CONFIG.proposalExpiryDays,
    signalHalfLifeDays:
      partial.signalHalfLifeDays ?? DEFAULT_DETECTOR_CONFIG.signalHalfLifeDays,
    lookbackDays:
      partial.lookbackDays ?? DEFAULT_DETECTOR_CONFIG.lookbackDays,
    scanIntervalHours:
      partial.scanIntervalHours ?? DEFAULT_DETECTOR_CONFIG.scanIntervalHours,
  });
}
