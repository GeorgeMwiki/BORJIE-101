/**
 * Swahili Intelligence Engine
 *
 * The living, learning Swahili NLP system for Borjie.
 * Every Swahili interaction makes us smarter.
 *
 * Architecture:
 * 1. Morphological Analyzer: Decomposes words into prefix + root + suffix
 * 2. Vocabulary Service: Living dictionary with user-taught words
 * 3. OOV Detector: Finds unknown words and asks for clarification
 * 4. Learning Pipeline: Processes user explanations into vocabulary
 * 5. Response Validator: Post-generation quality gate for Swahili output
 *
 * Integration: Plugs into the Borjie AI prompt assembler as
 * intelligence layers (Layers 13-17: Swahili Intelligence + quality gate).
 */

// ── Types ──
export type {
  NounClass,
  PartOfSpeech,
  VerbTense,
  DerivationalSuffix,
  MorphemeBreakdown,
  VocabularyEntry,
  VocabularyExample,
  VocabularySource,
  VocabularyStatus,
  UserVocabularySubmission,
  OOVDetectionResult,
  ClarificationRequest,
  LearningEvent,
  LearningEventType,
  LanguageTag,
  TokenLanguageTag,
  CodeSwitchAnalysis,
  SwahiliEngineConfig,
  Dialect,
} from "./types";

export { DEFAULT_ENGINE_CONFIG } from "./types";

// ── Morphological Analyzer ──
export {
  analyzeWord,
  extractRoot,
  detectNounClass,
  looksLikeSwahili,
  decomposeNasalPrefix,
  formatMorphemeString,
} from "./morphological-analyzer";

// ── Morpheme Pre-Tokenizer ──
export {
  morphemePreTokenize,
  getGrammarRulesForPrompt,
} from "./morpheme-tokenizer";

// ── Root Databases ──
export { KNOWN_VERB_ROOTS } from "./verb-roots";
export { KNOWN_NOUN_ROOTS } from "./noun-roots";

// ── Vocabulary Service ──
export {
  lookupWord,
  lookupBulk,
  learnFromUser,
  confirmWord,
  recordUsage,
  getVocabularyStats,
} from "./vocabulary-service";

export type { VocabularyStats } from "./vocabulary-service";

// ── OOV Detector ──
export {
  tokenizeSwahili,
  detectOOVWords,
  generateClarifications,
  detectTeachingResponse,
  buildVocabularyContextBlock,
} from "./oov-detector";

// ── Response Validator (Post-Generation Quality Gate) ──
export {
  validateSwahiliResponse,
  enforceTerminology,
} from "./response-validator";

export type {
  ValidationResult,
  ValidationIssue,
  ValidationContext,
  TerminologyCorrection,
} from "./response-validator";

// ── Convenience: Full Pipeline ──

import {
  DEFAULT_ENGINE_CONFIG,
  type SwahiliEngineConfig,
  type ClarificationRequest,
} from "./types";
import {
  detectOOVWords,
  generateClarifications,
  buildVocabularyContextBlock,
} from "./oov-detector";
import { learnFromUser } from "./vocabulary-service";

/**
 * Process a Swahili message through the full intelligence pipeline.
 *
 * 1. Detect OOV words
 * 2. Generate clarification questions (if any unknown words)
 * 3. Build vocabulary context for the AI prompt
 *
 * Call this BEFORE sending the message to the LLM.
 */
export async function processSwahiliMessage(
  message: string,
  sessionLearnedWords: ReadonlyMap<string, string>,
  config: SwahiliEngineConfig = DEFAULT_ENGINE_CONFIG,
): Promise<{
  readonly vocabularyContext: string | null;
  readonly clarifications: readonly ClarificationRequest[];
  readonly hasUnknownWords: boolean;
  readonly unknownWordCount: number;
}> {
  const oovResults = await detectOOVWords(message, config);
  const clarifications = generateClarifications(
    oovResults,
    message,
    config.maxClarificationPerMessage,
  );
  const vocabularyContext = buildVocabularyContextBlock(
    oovResults,
    sessionLearnedWords,
  );

  const unknownCount = oovResults.filter((r) => r.needsClarification).length;

  return {
    vocabularyContext,
    clarifications,
    hasUnknownWords: unknownCount > 0,
    unknownWordCount: unknownCount,
  };
}

/**
 * Handle a user teaching us a word.
 * Call this when `detectTeachingResponse` returns a match.
 */
export async function handleWordLearning(
  word: string,
  definition: string,
  contextSentence: string,
  userId: string | null,
  conversationId: string | null,
): Promise<void> {
  await learnFromUser({
    word,
    definitionProvided: definition,
    contextSentence,
    submittedBy: userId,
    conversationId,
  });
}
