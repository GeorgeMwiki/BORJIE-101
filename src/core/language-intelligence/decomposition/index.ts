/**
 * Atomic Document Decomposition Engine
 *
 * The universal standard for breaking ANY text or document into its smallest
 * retrievable components. This is the "dictionary DNA" of Borjie:
 *
 *   Text -> Paragraphs -> Sentences -> Phrases -> Tokens -> Morphemes
 *
 * Every level is Zod-validated, dictionary-verified, and indexed for
 * sub-millisecond retrieval. Swahili agglutinative morphology is
 * handled natively through the dictionary graph.
 *
 * Usage:
 * ```typescript
 * import {
 *   initializeDictionaryGraph,
 *   decomposeText,
 *   quickAnalyze,
 *   validateTranslation,
 *   fillGaps,
 * } from '@/core/language-intelligence/decomposition';
 *
 * // Initialize once at startup
 * await initializeDictionaryGraph();
 *
 * // Decompose any text
 * const atom = decomposeText("Ninataka mkopo wa biashara");
 * console.log(atom.stats.dictionaryCoverage); // 1.0 (all tokens found)
 *
 * // Quick analyze for chat
 * const analysis = quickAnalyze("I want a business loan");
 *
 * // Validate a translation
 * const validation = validateTranslation(
 *   "business loan", "mkopo wa biashara", "en", "sw"
 * );
 *
 * // Fill gaps for unknown terms
 * const gaps = await fillGaps(atom);
 * ```
 *
 * @module decomposition
 */

// ── Types ──────────────────────────────────────────────────────────────
export type {
  Morpheme,
  MorphemeType,
  Token,
  PartOfSpeech,
  Phrase,
  PhraseType,
  Sentence,
  Paragraph,
  DocumentAtom,
  DictionaryNode,
  TranslationValidation,
} from "./types";

export {
  MorphemeSchema,
  MorphemeTypeSchema,
  TokenSchema,
  PartOfSpeechSchema,
  PhraseSchema,
  PhraseTypeSchema,
  SentenceSchema,
  ParagraphSchema,
  DocumentAtomSchema,
  DictionaryNodeSchema,
  TranslationValidationSchema,
} from "./types";

// ── Dictionary Graph ───────────────────────────────────────────────────
export {
  DictionaryGraph,
  getDictionaryGraph,
  resetDictionaryGraph,
  type MorphologicalResult,
  type GraphStats,
} from "./dictionary-graph";

// ── Dataset Loader ─────────────────────────────────────────────────────
export {
  initializeDictionaryGraph,
  loadFinancialDictionary,
  loadCoreVocabulary,
  loadFromTranslationMemory,
  addDiscoveredTerm,
} from "./dataset-loader";

// ── Text Decomposer ───────────────────────────────────────────────────
export {
  decomposeText,
  quickAnalyze,
  type DecompositionOptions,
} from "./text-decomposer";

// ── Translation Validator ──────────────────────────────────────────────
export {
  validateTranslation,
  quickValidate,
  validateTranslationBatch,
  type ValidationConfig,
} from "./translation-validator";

// ── Gap Filler ────────────────────────────────────────────────────────
export {
  fillGaps,
  fillSingleGap,
  type GapFillerConfig,
  type GapFillResult,
} from "./gap-filler";
