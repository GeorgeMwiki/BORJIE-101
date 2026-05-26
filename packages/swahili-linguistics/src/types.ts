/**
 * `@borjie/swahili-linguistics` — public type surface (Wave 19H).
 *
 * Companion to Docs/DESIGN/SWAHILI_LINGUISTICS_SOTA_SPEC.md. Defines
 * the core domain shapes:
 *
 *   - NounClass        : 1..18 Bantu noun-class index.
 *   - Register         : formal | colloquial | sheng | coastal | bongo.
 *   - Dialect          : bongo | coastal | kenyan | sheng | standard.
 *   - Morpheme         : a single decomposed morpheme with slot tag.
 *   - VerbAnalysis     : the decomposition of a verb surface form.
 *   - NounAnalysis     : noun-class detection result.
 *   - SwahiliTerm      : a bilingual glossary entry.
 *   - DialectScore     : per-dialect score for an utterance.
 *   - Citation         : URL+title+date triple cited inline.
 *
 * All types are `readonly` and all constructors return frozen objects
 * — the project's immutability rule (~/.claude/rules/coding-style.md).
 *
 * Linguistic claims cite:
 *   - "Swahili grammar" — Wikipedia
 *     https://en.wikipedia.org/wiki/Swahili_grammar  (accessed 2026-05-26)
 *   - "Noun classification in Swahili" — UVA Kamusi Project
 *     https://www2.iath.virginia.edu/swahili/sect2.html  (accessed 2026-05-26)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Noun classes
// ---------------------------------------------------------------------------

/**
 * Bantu noun class index. Swahili has 18 traditional Bantu classes; in
 * standard Kiswahili Sanifu classes 12, 13 and 18 are vestigial. We
 * still type them in for round-trip with reference materials.
 *
 * Source: Wikipedia "Swahili grammar"
 * https://en.wikipedia.org/wiki/Swahili_grammar  (accessed 2026-05-26).
 */
export const NOUN_CLASSES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
] as const;

export type NounClass = (typeof NOUN_CLASSES)[number];

// ---------------------------------------------------------------------------
// Register + dialect
// ---------------------------------------------------------------------------

export const REGISTERS = [
  'formal',
  'colloquial',
  'sheng',
  'coastal',
  'bongo',
] as const;

export type Register = (typeof REGISTERS)[number];

export const DIALECTS = ['bongo', 'coastal', 'kenyan', 'sheng', 'standard'] as const;

export type Dialect = (typeof DIALECTS)[number];

// ---------------------------------------------------------------------------
// Morphology slot tags
// ---------------------------------------------------------------------------

/**
 * Slot ordinals for the templatic verb structure. The maximal slot
 * sequence is fixed (Wikipedia "Swahili grammar"; XSMA paper):
 *
 *   [NEG] [SUBJ] [NEG2] [TAM] [REL] [OBJ] [ROOT] [EXT...] [FV] [POST]
 */
export const MORPHEME_SLOTS = [
  'neg',
  'subj',
  'neg2',
  'tam',
  'rel',
  'obj',
  'root',
  'ext',
  'fv',
  'post',
  'nominal-prefix',
  'stem',
  'particle',
] as const;

export type MorphemeSlot = (typeof MORPHEME_SLOTS)[number];

export interface Morpheme {
  readonly value: string;
  readonly slot: MorphemeSlot;
  readonly gloss?: string;
}

// ---------------------------------------------------------------------------
// Part-of-speech tags
// ---------------------------------------------------------------------------

export const POS_TAGS = [
  'noun',
  'verb',
  'adj',
  'adv',
  'pron',
  'num',
  'conj',
  'prep',
  'particle',
] as const;

export type PosTag = (typeof POS_TAGS)[number];

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

export interface NounAnalysis {
  readonly surface: string;
  readonly lemma: string;
  readonly nounClass: NounClass;
  readonly pluralClass: NounClass | null;
  readonly isAnimate: boolean;
  readonly confidence: number;
}

export interface VerbAnalysis {
  readonly surface: string;
  readonly lemma: string;
  readonly morphemes: ReadonlyArray<Morpheme>;
  readonly subject: string | null;
  readonly tense: string | null;
  readonly object: string | null;
  readonly fv: string | null;
  readonly negated: boolean;
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export interface Citation {
  readonly url: string;
  readonly title: string;
  readonly accessedAt: string;
}

export interface SwahiliTerm {
  readonly term: string;
  readonly lemma: string;
  readonly nounClass: NounClass | null;
  readonly pluralClass: NounClass | null;
  readonly register: Register;
  readonly domain: string;
  readonly enEquivalent: string;
  readonly definition: {
    readonly sw: string;
    readonly en: string;
  };
  readonly citation: Citation;
}

// ---------------------------------------------------------------------------
// Dialect scoring
// ---------------------------------------------------------------------------

export interface DialectScore {
  readonly dialect: Dialect;
  readonly score: number;
  readonly signals: ReadonlyArray<string>;
}

export interface DialectDetectionResult {
  readonly scores: ReadonlyArray<DialectScore>;
  readonly topDialect: Dialect;
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Concord checking
// ---------------------------------------------------------------------------

export interface ConcordViolation {
  readonly kind: 'class-mismatch' | 'animate-override-missed' | 'tam-fv-mismatch';
  readonly expected: string;
  readonly actual: string;
  readonly position: number;
}

export interface ConcordCheckResult {
  readonly pass: boolean;
  readonly violations: ReadonlyArray<ConcordViolation>;
}

// ---------------------------------------------------------------------------
// Persistence row shapes (mirror migration 0049 columns; storage-agnostic)
// ---------------------------------------------------------------------------

export interface SwahiliTermRow {
  readonly id: string;
  readonly tenantId: string;
  readonly term: string;
  readonly lemma: string;
  readonly nounClass: NounClass | null;
  readonly pluralClass: NounClass | null;
  readonly register: Register;
  readonly domain: string;
  readonly enEquivalent: string;
  readonly definition: { readonly sw: string; readonly en: string };
  readonly citation: Citation;
  readonly createdAt: string;
  readonly auditHash: string;
}

export interface SwahiliMorphologyCacheRow {
  readonly id: string;
  readonly tenantId: string;
  readonly surfaceForm: string;
  readonly lemma: string;
  readonly morphemes: ReadonlyArray<Morpheme>;
  readonly pos: PosTag;
  readonly features: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly recordedAt: string;
  readonly auditHash: string;
}

export interface SwahiliDialectSignalRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly dialect: Dialect;
  readonly signalCount: number;
  readonly lastObserved: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Repository ports (storage-agnostic — implementations live in
// `repositories/` and use in-memory or SQL)
// ---------------------------------------------------------------------------

export interface SwahiliTermsRepository {
  insert(row: SwahiliTermRow): Promise<SwahiliTermRow>;
  lookupByTerm(
    tenantId: string,
    term: string,
    register?: Register,
  ): Promise<SwahiliTermRow | null>;
  listByDomain(
    tenantId: string,
    domain: string,
  ): Promise<ReadonlyArray<SwahiliTermRow>>;
}

export interface SwahiliMorphologyCacheRepository {
  upsert(row: SwahiliMorphologyCacheRow): Promise<SwahiliMorphologyCacheRow>;
  get(
    tenantId: string,
    surfaceForm: string,
  ): Promise<SwahiliMorphologyCacheRow | null>;
}

export interface SwahiliDialectSignalsRepository {
  increment(
    tenantId: string,
    userId: string,
    dialect: Dialect,
    observedAt: string,
  ): Promise<SwahiliDialectSignalRow>;
  read(
    tenantId: string,
    userId: string,
  ): Promise<ReadonlyArray<SwahiliDialectSignalRow>>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SwahiliLinguisticsError extends Error {
  public readonly code:
    | 'INVALID_INPUT'
    | 'UNKNOWN_CLASS'
    | 'PARSE_FAILED'
    | 'NOT_FOUND'
    | 'INTERNAL';
  constructor(
    message: string,
    code:
      | 'INVALID_INPUT'
      | 'UNKNOWN_CLASS'
      | 'PARSE_FAILED'
      | 'NOT_FOUND'
      | 'INTERNAL',
  ) {
    super(message);
    this.name = 'SwahiliLinguisticsError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — for callers validating untyped wire data
// ---------------------------------------------------------------------------

export const nounClassSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
  z.literal(10),
  z.literal(11),
  z.literal(12),
  z.literal(13),
  z.literal(14),
  z.literal(15),
  z.literal(16),
  z.literal(17),
  z.literal(18),
]);

export const registerSchema = z.enum(REGISTERS);

export const dialectSchema = z.enum(DIALECTS);
