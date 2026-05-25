/**
 * `@borjie/progressive-intelligence` — public types.
 *
 * Schema-evolving entities, entity resolution, active learning, live
 * coaching, streaming inference, multi-source profile unification, and
 * per-user few-shot personalization. All types are immutable
 * (`Readonly` / `ReadonlyArray`) so consumers can safely share them
 * across async boundaries without defensive copies.
 *
 * No DB dependency: every subsystem takes ports for IO. Same input →
 * same output. This package is pure.
 */

// ---------------------------------------------------------------------------
// Embedder port — shared shape with @borjie/user-context-store so the
// composition root can pass the same instance to both packages.
// ---------------------------------------------------------------------------

export interface Embedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
  /** Embedding dimensionality (so callers can sanity-check). */
  readonly dimension: number;
}

// ---------------------------------------------------------------------------
// Brain port — abstract LLM access. Subsystems that want LLM-assisted
// behavior accept this rather than importing a concrete client, so tests
// can pass a deterministic fake.
// ---------------------------------------------------------------------------

export interface BrainRequest {
  /** System / instructional prompt. */
  readonly system?: string;
  /** Primary user prompt (already personalized if applicable). */
  readonly prompt: string;
  /** Soft cap on tokens the brain should produce. */
  readonly maxTokens?: number;
  /** Optional per-request temperature, [0..1]. */
  readonly temperature?: number;
}

export interface BrainTokenChunk {
  readonly kind: 'token';
  readonly text: string;
}

export interface BrainErrorChunk {
  readonly kind: 'error';
  readonly message: string;
}

export interface BrainDoneChunk {
  readonly kind: 'done';
  /** Optional summary metadata (e.g. usage). */
  readonly meta?: Record<string, unknown>;
}

export type BrainChunk = BrainTokenChunk | BrainErrorChunk | BrainDoneChunk;

export interface Brain {
  /**
   * Stream completions. The async iterable must be replayable in the
   * sense that calling `for await` once consumes the stream — re-entry
   * is not required.
   */
  stream(request: BrainRequest): AsyncIterable<BrainChunk>;
}

// ---------------------------------------------------------------------------
// 1. Schema-evolving entities — `Entity` is a typed record with stable id,
// `EntityRef` is the lightweight pointer used across subsystems.
// ---------------------------------------------------------------------------

/**
 * The 5 pre-shipped entity kinds. Extra kinds may be added by callers
 * via the `string & {}` brand below; the well-known values document
 * the rails that work out of the box.
 */
export type EntityKind =
  | 'tenant'
  | 'vendor'
  | 'property'
  | 'parcel'
  | 'contact_person'
  | (string & {});

/**
 * Schema-evolving entity. `attributes` is open so newly captured fields
 * never break older consumers; `schemaVersion` lets services running
 * mixed versions reason about compatibility. Mirrors Pydantic v2 / Zod 4
 * mutable-schema pragmatism (see research notes).
 */
export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  /** Multi-tenant guard. */
  readonly tenantId: string;
  /** Open-ended attribute bag. Subsystems must not mutate. */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** ISO-8601. When the entity was last touched. */
  readonly updatedAt: string;
  /**
   * Monotonically increasing schema version. Bump when a new field is
   * promoted from "open attribute" to a typed slot. Default `1`.
   */
  readonly schemaVersion: number;
  /** Source system that produced this entity ("crm", "kyc", "scan", ...). */
  readonly source?: string;
}

export interface EntityRef {
  readonly id: string;
  readonly kind: EntityKind;
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// 2. Entity resolution — match candidates + decisions + merge proposals.
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  readonly entity: Entity;
  /** Optional pre-computed embedding for the dedup signal. */
  readonly embedding?: ReadonlyArray<number>;
}

export type MatchVerdict = 'match' | 'no_match' | 'uncertain';

export interface MatchScoreBreakdown {
  readonly embedding: number;
  readonly fuzzyString: number;
  readonly structural: number;
  readonly composite: number;
}

export interface MatchDecision {
  readonly verdict: MatchVerdict;
  /** Composite score in [0..1] used to make the verdict. */
  readonly score: number;
  /** Per-signal breakdown for explainability + downstream tuning. */
  readonly breakdown: MatchScoreBreakdown;
  /** The candidate(s) we ranked as matches (highest first). */
  readonly matches: ReadonlyArray<MatchCandidate>;
  /** Why we made this call — short reason codes. */
  readonly reasons: ReadonlyArray<string>;
}

export type MergeStrategy = 'prefer_winner' | 'union' | 'most_recent';

export interface MergeProposal {
  readonly winnerId: string;
  /** Ids of the entities that should be merged into the winner. */
  readonly loserIds: ReadonlyArray<string>;
  /** Result of applying the chosen strategy — a new (proposed) entity. */
  readonly merged: Entity;
  readonly strategy: MergeStrategy;
  /** Per-field origin trail so consumers can render "kept from X". */
  readonly fieldOrigins: Readonly<Record<string, string>>;
  /**
   * Deterministic id over (winner, sorted losers, strategy). Callers may
   * use it for idempotent upserts.
   */
  readonly proposalKey: string;
}

// ---------------------------------------------------------------------------
// 3. Active learning — uncertain cases, label requests, model updates.
// ---------------------------------------------------------------------------

export interface Prediction<T = unknown> {
  readonly id: string;
  readonly value: T;
  /** Float in [0..1]. */
  readonly confidence: number;
  /** Original input for re-labeling. */
  readonly input: Readonly<Record<string, unknown>>;
}

export interface UncertainCase<T = unknown> {
  readonly id: string;
  readonly prediction: Prediction<T>;
  /** How far below the threshold the confidence was, in [0..1]. */
  readonly gap: number;
  /** Reason code — `low_confidence` | `outlier` | `noisy_label`. */
  readonly reason: 'low_confidence' | 'outlier' | 'noisy_label';
}

export type LabelOracle = 'human' | 'llm-jury';

export interface LabelRequest<T = unknown> {
  readonly caseId: string;
  readonly oracle: LabelOracle;
  /** ISO-8601 when the request was opened. */
  readonly requestedAt: string;
  /** Original prediction we want labeled. */
  readonly prediction: Prediction<T>;
  /** Free-form notes the requester wants the oracle to see. */
  readonly note?: string;
}

export interface Label<T = unknown> {
  readonly caseId: string;
  readonly value: T;
  readonly oracle: LabelOracle;
  /** ISO-8601 when the label was provided. */
  readonly labeledAt: string;
  /** Optional confidence the oracle had in its own label, [0..1]. */
  readonly oracleConfidence?: number;
}

/** Tiny model state — caller persists in their own store. */
export interface UpdatedModel<T = unknown> {
  readonly version: number;
  /** Total cases the model has been trained on. */
  readonly totalCases: number;
  /** Cases that have a confirmed label. */
  readonly labeledCases: number;
  /** Fraction of human + jury labels that agree, [0..1]. */
  readonly agreementRate: number;
  /** Append-only label log. Newest last. */
  readonly labels: ReadonlyArray<Label<T>>;
}

// ---------------------------------------------------------------------------
// 4. Live coaching — inline hints during data entry.
// ---------------------------------------------------------------------------

export interface CoachingSchemaField {
  readonly name: string;
  readonly type: 'string' | 'number' | 'date' | 'enum' | 'boolean' | 'json';
  readonly required?: boolean;
  /** Optional reference range for numeric / monetary fields. */
  readonly expectedRange?: { readonly min?: number; readonly max?: number };
  /** Optional enum values. */
  readonly allowedValues?: ReadonlyArray<string>;
  /** Human label for the hint copy. */
  readonly label?: string;
}

export interface CoachingSchema {
  readonly entityKind: EntityKind;
  readonly fields: ReadonlyArray<CoachingSchemaField>;
}

export type CoachingSeverity = 'info' | 'warn' | 'block';

export interface CoachingHint {
  /** Stable id per (field, severity, reason) — safe for React keys. */
  readonly id: string;
  readonly field: string;
  readonly severity: CoachingSeverity;
  readonly message: string;
  /** Confidence in the hint itself, [0..1]. */
  readonly confidence: number;
  /** Optional suggested next action the UI can render as a chip. */
  readonly suggestion?: string;
  /** Reason code; helpful for analytics + de-duping in the UI. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// 5. Streaming inference — SSE-friendly event envelope.
// ---------------------------------------------------------------------------

export type StreamingEventKind = 'token' | 'meta' | 'error' | 'done' | 'heartbeat';

export interface StreamingEvent {
  /** Monotonic per-stream event id — used for SSE `Last-Event-ID` resume. */
  readonly id: number;
  readonly kind: StreamingEventKind;
  /** Token text (kind='token') or status detail (other kinds). */
  readonly data: string;
  /** ISO-8601 when emitted. */
  readonly ts: string;
  /** Optional structured payload (kind='meta' | 'done'). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// 6. Profile unification — fragments from many sources → one canonical view.
// ---------------------------------------------------------------------------

export type ProfileFragmentSource =
  | 'supabase_auth'
  | 'stripe_customer'
  | 'mpesa_txn'
  | 'document_scan'
  | 'conversation'
  | 'crm'
  | (string & {});

export interface ProfileFragment {
  readonly id: string;
  readonly subjectHintId?: string;
  readonly tenantId: string;
  readonly source: ProfileFragmentSource;
  /** Open-ended attribute bag — email, phone, name, ext ids, ... */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** ISO-8601 capture timestamp. */
  readonly capturedAt: string;
  /** Optional pre-computed embedding for linking heuristics. */
  readonly embedding?: ReadonlyArray<number>;
}

export interface LinkProposal {
  readonly aId: string;
  readonly bId: string;
  /** Score in [0..1] — same scale as MatchDecision.score. */
  readonly score: number;
  readonly reasons: ReadonlyArray<string>;
}

export interface UnifiedProfile {
  readonly subjectId: string;
  readonly tenantId: string;
  /** Canonical attributes after unification. */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** Per-attribute origin so consumers can render "from Stripe". */
  readonly attributeOrigins: Readonly<Record<string, ProfileFragmentSource>>;
  /** All fragments that contributed (append-only). */
  readonly fragments: ReadonlyArray<ProfileFragment>;
  /** ISO-8601. Latest fragment timestamp. */
  readonly lastFragmentAt: string;
  /** Schema version — bumped when a new attribute is promoted to a typed slot. */
  readonly schemaVersion: number;
}

export interface UnifyRules {
  /** Score threshold above which two fragments are considered the same subject. */
  readonly linkThreshold: number;
  /**
   * Conflict resolution for scalar attributes. `most_recent` keeps the
   * value from the latest fragment; `authoritative` defers to the
   * source listed first in `authoritativeOrder`.
   */
  readonly resolveScalarsBy: 'most_recent' | 'authoritative';
  readonly authoritativeOrder?: ReadonlyArray<ProfileFragmentSource>;
}

// ---------------------------------------------------------------------------
// 7. Personalization — per-user few-shot prompt augmentation.
// ---------------------------------------------------------------------------

export interface PersonalizationUser {
  readonly userId: string;
  readonly tenantId: string;
  /** Optional preferences blob — informs the system prompt. */
  readonly preferences?: Readonly<Record<string, unknown>>;
}

export interface PersonalizationExample {
  readonly id: string;
  readonly userId: string;
  /** The kind of historical event ("question", "answer", "doc", ...). */
  readonly kind: string;
  readonly content: string;
  /** Pre-computed embedding (recommended). */
  readonly embedding?: ReadonlyArray<number>;
  /** ISO-8601 when the example was captured. */
  readonly createdAt: string;
}
