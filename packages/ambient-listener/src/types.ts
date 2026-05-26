/**
 * Ambient voice listening — public type surface (Wave 19J).
 *
 * Companion to Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md. Every record
 * here is immutable. State transitions
 * (`not-set → granted → revoked → granted ...`) produce new projections via
 * dedicated handlers — never an in-place mutation. This mirrors the
 * immutability discipline used across the Borjie codebase.
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md —
 * Decisions 3 + 4 (privacy tiers + 90-day re-consent + employee opt-out).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/**
 * 90-day re-consent window. Beyond this Mr. Mwikila must silent-disable
 * until the user/admin re-confirms. From FOUNDER_LOCKED Decision 4.4.
 */
export const RE_CONSENT_WINDOW_DAYS = 90;

/**
 * 24-hour opt-out window. From FOUNDER_LOCKED Decision 4.2 — every
 * employee can opt themselves back to BALANCED for their own session
 * for the next 24 h after a mode change.
 */
export const OPT_OUT_WINDOW_HOURS = 24;

/**
 * Kill-switch look-back window. Any kill-switch event triggered in this
 * window silent-disables the pipeline. 24 h matches the opt-out window.
 */
export const KILL_SWITCH_LOOKBACK_HOURS = 24;

/**
 * Circuit-breaker threshold — N consecutive failures in any single
 * failure mode trips the per-tenant fuse.
 */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/**
 * Sentiment is bounded by spec §6 + the SQL check constraint
 * `ambient_captures_sentiment_range`.
 */
export const SENTIMENT_MIN = -1;
export const SENTIMENT_MAX = 1;

// ---------------------------------------------------------------------------
// Channels, consent states, intents, entity kinds, scopes
// ---------------------------------------------------------------------------

export const AMBIENT_CHANNELS = ['chat', 'voice_call', 'sms'] as const;
export type AmbientChannel = (typeof AMBIENT_CHANNELS)[number];

export const CONSENT_STATES = ['granted', 'revoked', 'not-set'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export const KILL_SWITCH_SCOPES = ['user', 'org'] as const;
export type KillSwitchScope = (typeof KILL_SWITCH_SCOPES)[number];

/**
 * Closed mining-domain intent ontology. See spec §5 — closed so the
 * cognitive-memory recall can index by intent without combinatorial
 * explosion.
 */
export const INTENT_KINDS = [
  'book_inspection',
  'report_incident',
  'query_parcel_status',
  'request_meeting',
  'escalate_safety',
  'other',
] as const;

export type Intent = (typeof INTENT_KINDS)[number];

/**
 * Entity kinds. Mining-domain skewed (parcel_id, licence_id, mineral,
 * equipment) but the ontology is intentionally small so the dual-encoder
 * retriever can bucket without combinatorial explosion. See spec §5.
 */
export const ENTITY_KINDS = [
  'person',
  'org',
  'location',
  'parcel_id',
  'licence_id',
  'date',
  'mineral',
  'equipment',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

// ---------------------------------------------------------------------------
// Domain types — all immutable
// ---------------------------------------------------------------------------

/**
 * A consent row. Composite primary key (tenant_id, user_id, channel) —
 * each channel is independently consented (spec §2). `granted_at` /
 * `revoked_at` are nullable, set on the corresponding transition.
 */
export interface AmbientConsent {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly channel: AmbientChannel;
  readonly consent_state: ConsentState;
  /** Per-spec §6 — sentiment is a separate axis. */
  readonly sentiment_consent: boolean;
  readonly granted_at: string | null;
  readonly revoked_at: string | null;
  readonly granted_by: string | null;
  readonly audit_hash: string;
}

/**
 * One entity hit in a captured fragment. `value_hash` is the salted-hash
 * from the session-mirror redactor (`sha256(tenant_id:field_id:value)`),
 * so the same NIDA/M-Pesa/parcel-id in a different tenant is unlinkable.
 */
export interface EntityHit {
  readonly kind: EntityKind;
  /** Salted hash of the underlying identifier; never the plaintext. */
  readonly value_hash: string;
  /** Span in the redacted text where the entity was matched. */
  readonly span: { readonly start: number; readonly end: number };
}

/**
 * A persisted capture. The audit chain runs through `prev_hash` →
 * `audit_hash`; `prev_hash` is the audit_hash of the prior row for the
 * same (tenant, source_session_id), or `null` for the first row.
 */
export interface AmbientCapture {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly channel: AmbientChannel;
  readonly source_session_id: string;
  readonly captured_at: string;
  /** Plaintext with every PII match replaced by a salted-hash token. */
  readonly redacted_text: string;
  readonly intent: Intent;
  readonly entities: ReadonlyArray<EntityHit>;
  /** Bounded scalar in [SENTIMENT_MIN, SENTIMENT_MAX]; null when not consented. */
  readonly sentiment: number | null;
  readonly audit_hash: string;
  readonly prev_hash: string | null;
}

/**
 * Kill-switch trigger event. `scope='user'` requires `target_user_id`;
 * `scope='org'` ignores it (the whole tenant is killed). Append-only.
 */
export interface KillSwitchEvent {
  readonly id: string;
  readonly tenant_id: string;
  readonly triggered_by: string;
  readonly triggered_at: string;
  readonly reason: string;
  readonly scope: KillSwitchScope;
  readonly target_user_id: string | null;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Pipeline operation shapes
// ---------------------------------------------------------------------------

/**
 * The input to a single pipeline turn. Audio is opaque (a transport-
 * level payload — the VAD port decides how to interpret it). The
 * pipeline drives the audio through VAD → diarise → STT → redact →
 * extract; intermediate results are not surfaced.
 */
export interface PipelineInput {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly channel: AmbientChannel;
  readonly source_session_id: string;
  /** Opaque audio payload — bytes, URL, etc. The VAD port owns the shape. */
  readonly audio: AudioPayload;
  /** Wall-clock when the input was received (for audit + opt-out checks). */
  readonly received_at: Date;
  /** Optional override for testing — defaults to `received_at`. */
  readonly captured_at?: Date;
}

/**
 * Opaque audio. Concrete shape is up to the VAD impl — most production
 * impls will pass a frame-level buffer; some test impls pass a string
 * pre-transcribed marker. The pipeline never inspects this directly.
 */
export type AudioPayload = Readonly<Record<string, unknown>>;

/**
 * Result of a pipeline turn. `outcome='listening'` means a capture row
 * was persisted; every other outcome means the pipeline silent-
 * disabled (and the capture row was NOT persisted). The host MUST
 * treat any non-'listening' outcome as "Mr. Mwikila is not listening
 * right now."
 */
export type PipelineOutcome =
  | { readonly outcome: 'listening'; readonly capture: AmbientCapture }
  | { readonly outcome: 'silent-disabled'; readonly reason: SilentDisableReason };

/**
 * Why the pipeline silent-disabled. Every gap is counted in metrics so
 * SRE can prove the gate works. See spec §8.
 */
export type SilentDisableReason =
  | 'consent-not-set'
  | 'consent-revoked'
  | 'consent-expired-90d'
  | 'kill-switch-user'
  | 'kill-switch-org'
  | 'redactor-error'
  | 'vad-error'
  | 'stt-error'
  | 'extractor-error'
  | 'circuit-breaker-open';

// ---------------------------------------------------------------------------
// Ports — host-owned interfaces. No I/O in this package.
// ---------------------------------------------------------------------------

/**
 * Voice activity detection — returns either `null` (no voice in this
 * frame; the pipeline should NOT proceed to STT) or a `VadHit`
 * containing the start/end of the speech span.
 */
export interface VadPort {
  detect(audio: AudioPayload): Promise<VadHit | null>;
}

export interface VadHit {
  readonly start_ms: number;
  readonly end_ms: number;
  /** Confidence in [0, 1]; values below caller's threshold should be dropped. */
  readonly confidence: number;
}

/**
 * Speaker diarisation — given an audio span, returns the per-speaker
 * intervals. Order is wall-clock ascending. `speaker_id` is opaque (any
 * stable string); the production impl will set it to a salted hash so
 * the speaker is unlinkable cross-tenant.
 */
export interface DiarisePort {
  diarise(audio: AudioPayload, hit: VadHit): Promise<ReadonlyArray<DiariseSpan>>;
}

export interface DiariseSpan {
  readonly speaker_id: string;
  readonly start_ms: number;
  readonly end_ms: number;
}

/**
 * Speech-to-text. The implementation is chosen by the pipeline based on
 * the consent's `sensitivity` (Gemini Live for standard, Whisper-local
 * for highly-sensitive). The port is sensitivity-agnostic.
 */
export interface SttPort {
  transcribe(args: SttArgs): Promise<SttResult>;
}

export interface SttArgs {
  readonly audio: AudioPayload;
  readonly hit: VadHit;
  readonly speakers: ReadonlyArray<DiariseSpan>;
  /** Language tag (sw | sw-TZ | en-KE | ...). */
  readonly language: string;
}

export interface SttResult {
  readonly transcript: string;
  /** Provider that returned this transcript (audit). */
  readonly provider: string;
}

/**
 * PII redactor port. The reference impl delegates to the salted-hash
 * pattern in `packages/session-mirror/src/field-capture/pii-redactor.ts`
 * via the `hasher` callback. The pipeline calls this BEFORE the
 * extractor so the LLM never sees raw PII.
 */
export interface PiiRedactorPort {
  redact(args: PiiRedactArgs): Promise<RedactedText>;
}

export interface PiiRedactArgs {
  readonly tenant_id: string;
  readonly source_session_id: string;
  readonly transcript: string;
}

export interface RedactedText {
  /** Plaintext with every PII match replaced by a hashed token. */
  readonly text: string;
  /** Spans that were redacted — useful for audit + entity mapping. */
  readonly redacted_spans: ReadonlyArray<RedactedSpan>;
}

export interface RedactedSpan {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly value_hash: string;
}

/**
 * Intent extraction — returns one of the closed `INTENT_KINDS`. The
 * reference impl is LLM-backed; production hosts can swap in a fine-
 * tuned dual-encoder retriever.
 */
export interface IntentExtractorPort {
  extract(redacted: RedactedText): Promise<Intent>;
}

/** Entity extraction — returns the salted-hash `EntityHit` array. */
export interface EntityExtractorPort {
  extract(redacted: RedactedText): Promise<ReadonlyArray<EntityHit>>;
}

/**
 * Sentiment — bounded scalar in [SENTIMENT_MIN, SENTIMENT_MAX]. Only
 * called when the consent row's `sentiment_consent` is true.
 */
export interface SentimentExtractorPort {
  extract(redacted: RedactedText): Promise<number>;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

export interface AmbientConsentsRepository {
  get(
    tenant_id: string,
    user_id: string,
    channel: AmbientChannel,
  ): Promise<AmbientConsent | null>;
  upsert(consent: AmbientConsent): Promise<void>;
  listForUser(
    tenant_id: string,
    user_id: string,
  ): Promise<ReadonlyArray<AmbientConsent>>;
}

export interface AmbientCapturesRepository {
  insert(capture: AmbientCapture): Promise<void>;
  /** Most recent capture for `(tenant, source_session_id)` — used to chain prev_hash. */
  latestForSession(
    tenant_id: string,
    source_session_id: string,
  ): Promise<AmbientCapture | null>;
  listForUser(
    tenant_id: string,
    user_id: string,
  ): Promise<ReadonlyArray<AmbientCapture>>;
}

export interface KillSwitchEventsRepository {
  insert(event: KillSwitchEvent): Promise<void>;
  /**
   * Returns true when there is ANY kill-switch event in the last
   * `KILL_SWITCH_LOOKBACK_HOURS` matching either `scope='org'` for the
   * tenant or `scope='user'` for the specific user.
   */
  isActive(
    tenant_id: string,
    user_id: string,
    now: Date,
  ): Promise<{ readonly active: boolean; readonly scope?: KillSwitchScope }>;
  listForTenant(tenant_id: string): Promise<ReadonlyArray<KillSwitchEvent>>;
}

// ---------------------------------------------------------------------------
// Auxiliary ports
// ---------------------------------------------------------------------------

export interface AuditChainPort {
  append(payload: Readonly<Record<string, unknown>>): Promise<string>;
}

export interface CognitiveMemoryWriterPort {
  /**
   * Push a redacted capture into cognitive-memory as a `terminology` or
   * `preference` cell. The `consent_state` MUST be stamped on
   * `provenance.consent_state` verbatim, per FOUNDER_LOCKED Decision 4.3.
   */
  observe(args: CognitiveMemoryObserveArgs): Promise<void>;
}

export interface CognitiveMemoryObserveArgs {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly redacted_text: string;
  readonly intent: Intent;
  readonly entities: ReadonlyArray<EntityHit>;
  readonly sentiment: number | null;
  readonly consent_state: ConsentState;
  readonly captured_at: string;
  readonly source_session_id: string;
}

export interface MetricsPort {
  /** Increment a counter. Labels are arbitrary string → string. */
  incrementCounter(
    name: string,
    labels?: Readonly<Record<string, string>>,
  ): void;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AmbientListenerError extends Error {
  public override readonly name = 'AmbientListenerError';
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — runtime validation at host boundaries
// ---------------------------------------------------------------------------

export const ambientChannelSchema = z.enum(AMBIENT_CHANNELS);
export const consentStateSchema = z.enum(CONSENT_STATES);
export const killSwitchScopeSchema = z.enum(KILL_SWITCH_SCOPES);
export const intentSchema = z.enum(INTENT_KINDS);
export const entityKindSchema = z.enum(ENTITY_KINDS);

export const ambientConsentSchema = z.object({
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  channel: ambientChannelSchema,
  consent_state: consentStateSchema,
  sentiment_consent: z.boolean(),
  granted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  granted_by: z.string().nullable(),
  audit_hash: z.string(),
});

export const entityHitSchema = z.object({
  kind: entityKindSchema,
  value_hash: z.string().min(1),
  span: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});

export const ambientCaptureSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  channel: ambientChannelSchema,
  source_session_id: z.string().min(1),
  captured_at: z.string(),
  redacted_text: z.string(),
  intent: intentSchema,
  entities: z.array(entityHitSchema),
  sentiment: z.number().min(SENTIMENT_MIN).max(SENTIMENT_MAX).nullable(),
  audit_hash: z.string(),
  prev_hash: z.string().nullable(),
});

export const killSwitchEventSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  triggered_by: z.string().min(1),
  triggered_at: z.string(),
  reason: z.string().min(1),
  scope: killSwitchScopeSchema,
  target_user_id: z.string().nullable(),
  audit_hash: z.string(),
});
