/**
 * `@borjie/tacit-knowledge` — public type surface.
 *
 * Wave HARVEST. Mirrors the 3-table schema introduced by migration
 * `0044_tacit_knowledge.sql` and defines the port contracts that
 * keep the package independent of the cognitive-memory build:
 *
 *   - Interview          — a row in `tacit_interviews`.
 *   - Extraction         — a row in `tacit_extractions`.
 *   - Consent            — a row in `tacit_consents`.
 *   - CognitiveMemorySink — write port into the cognitive-memory store.
 *   - VectorIndex         — port for cosine/redundancy search.
 *   - EntityExtractor     — port for the LLM extraction call.
 *
 * Spec: `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md`.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mode enumeration — the five session shapes
// ---------------------------------------------------------------------------

/**
 * The five interview modes. Selection is made by Mr. Mwikila based
 * on the situation; the subject is never told the mode label in
 * user-facing text.
 */
export const INTERVIEW_MODES = [
  'walk-the-floor',
  'post-incident',
  'ride-along',
  'deal-replay',
  'cross-role',
] as const;

export type InterviewMode = (typeof INTERVIEW_MODES)[number];

/**
 * Interview lifecycle status.
 *
 *   - `running`         — the session is open; turns are being
 *                          appended to the transcript.
 *   - `ended_ok`        — the session ended cleanly; extractor +
 *                          cell-writer ran to completion.
 *   - `ended_revoked`   — the subject revoked consent mid-session;
 *                          no further persistence accepted.
 *   - `ended_error`     — the engine aborted (extractor failure,
 *                          adapter exception, etc.).
 */
export const INTERVIEW_STATUSES = [
  'running',
  'ended_ok',
  'ended_revoked',
  'ended_error',
] as const;

export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/**
 * The 8 entity kinds the extractor may emit. Aligned with the
 * 8 MemoryKinds in `@borjie/cognitive-memory`.
 */
export const ENTITY_KINDS = [
  'pattern',
  'fact',
  'rule',
  'preference',
  'template',
  'citation',
  'failure',
  'terminology',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Consent status — `granted` is the default.
 */
export const CONSENT_STATUSES = ['granted', 'revoked'] as const;

export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Geo + transcript shapes
// ---------------------------------------------------------------------------

/** Lat/lng pair carrying the session anchor (or per-turn GPS tag). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * One turn in the transcript. `speaker` is `'mr-mwikila'` for the
 * interviewer or `'subject'` for the person being interviewed.
 * `gps` is optional — populated for ride-along turns.
 */
export interface TranscriptTurn {
  readonly speaker: 'mr-mwikila' | 'subject';
  readonly text: string;
  readonly at: string; // ISO timestamp
  readonly gps?: GeoPoint;
}

// ---------------------------------------------------------------------------
// Domain rows
// ---------------------------------------------------------------------------

/**
 * One harvest session. Mirrors the `tacit_interviews` row shape.
 */
export interface Interview {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectUserId: string;
  readonly interviewer: string;
  readonly mode: InterviewMode;
  readonly startedAt: string; // ISO
  readonly endedAt: string | null;
  readonly status: InterviewStatus;
  readonly transcript: ReadonlyArray<TranscriptTurn>;
  readonly locationGeog: GeoPoint | null;
  readonly auditHash: string;
  readonly prevHash: string;
}

/**
 * One extracted know-how artifact. Mirrors `tacit_extractions`.
 *
 * `novel` is the extractor's own claim; the redundancy checker may
 * flip it to false. `redundantWithCellId` is set when a match exists.
 * `persistedCellId` is set once the cell-writer completes the write
 * into cognitive-memory via the `CognitiveMemorySink` port.
 */
export interface Extraction {
  readonly id: string;
  readonly interviewId: string;
  readonly tenantId: string;
  readonly entityKind: EntityKind;
  readonly entity: ExtractionEntity;
  readonly confidence: number;
  readonly novel: boolean;
  readonly redundantWithCellId: string | null;
  readonly persistedCellId: string | null;
  readonly createdAt: string; // ISO
  readonly auditHash: string;
}

/**
 * The extracted payload. Structured fields are kind-specific; the
 * canonical text form is always carried in `text` so the redundancy
 * checker can run a lexical comparison.
 */
export interface ExtractionEntity {
  readonly text: string;
  readonly structured: Readonly<Record<string, unknown>>;
  readonly citations: ReadonlyArray<{
    readonly span: string;
    readonly turnIndex: number;
  }>;
}

/**
 * One consent record. PK is (subjectUserId, tenantId). Default
 * `status = 'granted'`. `revokedAt` is set on revoke.
 */
export interface Consent {
  readonly subjectUserId: string;
  readonly tenantId: string;
  readonly status: ConsentStatus;
  readonly grantedAt: string; // ISO
  readonly revokedAt: string | null;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Inputs — every mutation requires explicit, validated input
// ---------------------------------------------------------------------------

export interface StartInterviewInput {
  readonly tenantId: string;
  readonly subjectUserId: string;
  readonly mode: InterviewMode;
  readonly interviewer?: string;
  readonly locationGeog?: GeoPoint;
}

export interface AppendTurnInput {
  readonly interviewId: string;
  readonly tenantId: string;
  readonly turn: TranscriptTurn;
}

export interface CompleteInterviewInput {
  readonly interviewId: string;
  readonly tenantId: string;
  readonly status: InterviewStatus;
}

// ---------------------------------------------------------------------------
// Ports — narrow, swappable boundaries
// ---------------------------------------------------------------------------

/**
 * Repository port for `tacit_interviews`. The in-memory adapter is
 * used in tests; the SQL adapter is wired in production.
 */
export interface TacitInterviewRepository {
  insert(row: Interview): Promise<Interview>;
  read(id: string, tenantId: string): Promise<Interview | null>;
  appendTurn(
    id: string,
    tenantId: string,
    turn: TranscriptTurn,
  ): Promise<Interview | null>;
  setStatus(
    id: string,
    tenantId: string,
    status: InterviewStatus,
    endedAt: string,
  ): Promise<Interview | null>;
}

export interface TacitExtractionRepository {
  insert(row: Extraction): Promise<Extraction>;
  read(id: string, tenantId: string): Promise<Extraction | null>;
  listForInterview(
    interviewId: string,
    tenantId: string,
  ): Promise<ReadonlyArray<Extraction>>;
  setRedundantWith(
    id: string,
    tenantId: string,
    cellId: string,
  ): Promise<Extraction | null>;
  setPersisted(
    id: string,
    tenantId: string,
    cellId: string,
  ): Promise<Extraction | null>;
}

export interface TacitConsentRepository {
  grant(subjectUserId: string, tenantId: string): Promise<Consent>;
  revoke(subjectUserId: string, tenantId: string): Promise<Consent | null>;
  read(
    subjectUserId: string,
    tenantId: string,
  ): Promise<Consent | null>;
}

/**
 * Port the extractor consumes — supplies one LLM-driven extraction
 * call per transcript chunk. The reference implementation ships in
 * this package; production wires `@borjie/brain-llm-router`.
 */
export interface EntityExtractor {
  extract(input: {
    readonly tenantId: string;
    readonly mode: InterviewMode;
    readonly chunk: ReadonlyArray<TranscriptTurn>;
  }): Promise<ReadonlyArray<ExtractionDraft>>;
}

/**
 * Draft form of an extraction — what the extractor emits *before*
 * the redundancy checker decides whether it is novel. The id, audit
 * hash, and `redundantWithCellId` / `persistedCellId` fields are
 * filled by the engine.
 */
export interface ExtractionDraft {
  readonly entityKind: EntityKind;
  readonly entity: ExtractionEntity;
  readonly confidence: number;
  readonly novel: boolean;
}

/**
 * Port for vector + lexical redundancy similarity. Production wires
 * pgvector via `@borjie/cognitive-memory`. The reference adapter is
 * an in-memory cosine implementation.
 */
export interface VectorIndex {
  /**
   * Find the top match (if any) above the cosine threshold. Returns
   * null when the index is empty or no match clears the threshold.
   */
  findNearest(input: {
    readonly tenantId: string;
    readonly text: string;
    readonly threshold: number;
  }): Promise<{ readonly cellId: string; readonly similarity: number } | null>;
}

/**
 * Port for writing into the cognitive-memory store. The package does
 * NOT import `@borjie/cognitive-memory` directly — the host wires
 * the production sink (observe / reinforce). The reference adapter
 * is a deterministic stub for tests.
 */
export interface CognitiveMemorySink {
  observe(input: CognitiveMemoryObserveInput): Promise<{ readonly cellId: string }>;
  reinforce(input: CognitiveMemoryReinforceInput): Promise<{ readonly cellId: string }>;
}

export interface CognitiveMemoryObserveInput {
  readonly tenantId: string;
  readonly subjectUserId: string;
  readonly interviewId: string;
  readonly mode: InterviewMode;
  readonly entityKind: EntityKind;
  readonly entity: ExtractionEntity;
  readonly confidence: number;
  readonly at: string; // ISO
  readonly place: GeoPoint | null;
}

export interface CognitiveMemoryReinforceInput {
  readonly tenantId: string;
  readonly cellId: string;
  readonly interviewId: string;
  readonly additionalConfidence: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TacitKnowledgeError extends Error {
  public override readonly name: string = 'TacitKnowledgeError';
  public readonly code: string;
  public readonly causeDetail?: Readonly<Record<string, unknown>>;
  public constructor(
    code: string,
    message: string,
    causeDetail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.code = code;
    if (causeDetail !== undefined) {
      this.causeDetail = causeDetail;
    }
  }
}

// ---------------------------------------------------------------------------
// Thresholds — see Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md §3.
// ---------------------------------------------------------------------------

/** Cosine threshold above which two cells are treated as the same. */
export const REDUNDANCY_COSINE_THRESHOLD = 0.86;

/** Lexical Jaccard threshold (token-level) for the second pass. */
export const REDUNDANCY_LEXICAL_THRESHOLD = 0.55;

/** Reinforcement confidence delta applied when redundancy detected. */
export const REINFORCE_CONFIDENCE_DELTA = 0.05;

// ---------------------------------------------------------------------------
// Zod schemas — public-boundary validation
// ---------------------------------------------------------------------------

export const interviewModeSchema = z.enum(INTERVIEW_MODES);
export const entityKindSchema = z.enum(ENTITY_KINDS);
export const interviewStatusSchema = z.enum(INTERVIEW_STATUSES);
export const consentStatusSchema = z.enum(CONSENT_STATUSES);

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const transcriptTurnSchema = z.object({
  speaker: z.enum(['mr-mwikila', 'subject']),
  text: z.string().min(1),
  at: z.string().min(1),
  gps: geoPointSchema.optional(),
});

export const startInterviewInputSchema = z.object({
  tenantId: z.string().min(1),
  subjectUserId: z.string().min(1),
  mode: interviewModeSchema,
  interviewer: z.string().optional(),
  locationGeog: geoPointSchema.optional(),
});

export const appendTurnInputSchema = z.object({
  interviewId: z.string().min(1),
  tenantId: z.string().min(1),
  turn: transcriptTurnSchema,
});
