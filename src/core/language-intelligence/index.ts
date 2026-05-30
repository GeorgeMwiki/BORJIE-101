/**
 * Language Intelligence Module
 *
 * Core Swahili-English language detection, spelling correction,
 * translation memory, and vocabulary learning for the Borjie platform.
 *
 * This module powers the continuously-improving Swahili-English language
 * intelligence engine that learns from every user interaction.
 */

// Types
export type {
  SupportedLanguage,
  CodeSwitchingPattern,
  FormalityLevel,
  LanguageDetectionResult,
  SpellingCorrection,
  SpellingCorrectionResult,
  SpellingCorrectionType,
  TranslationSource,
  TranslationMemoryEntry,
  ObservedTranslation,
  LearnedVocabulary,
  FinancialDictionaryEntry,
  GeneralVocabularyEntry,
  SpellingCorrectionEntry,
  LanguageMixingPattern,
  UserLanguageProfile,
} from "./types";

// Language Detection (multi-language, learnable)
export {
  detectLanguage,
  containsSwahili,
  getVocabularySize,
  registerLanguagePack,
  learnWord,
  getRegisteredLanguages,
} from "./language-detector";
export type { LanguagePack } from "./language-detector";

// Spelling Correction
export { correctSpelling, getCorrectionCount } from "./spelling-corrector";

// Translation Memory
export {
  findTranslation,
  findFuzzyTranslation,
  recordTranslation,
  extractInlineTranslations,
  getFrequentTerms,
  getRecentlyLearned,
  getMemoryStats,
} from "./translation-memory";

// NLLB Translation Service (4-tier cascade + code-switching)
export {
  translate,
  translateBatch,
  translateCodeSwitched,
  applyGlossaryConstraints,
  getTranslationServiceStats,
  type TranslationRequest,
  type TranslationResult,
  type TranslationServiceStats,
} from "./nllb-translation-service";

// Vocabulary Learning
export {
  processMessage,
  processAIResponse,
  getVocabularyStats,
  getLearnedWords,
  getWordsForContext,
} from "./vocabulary-learner";

// Pronunciation Guide
export {
  getPronunciation,
  searchPronunciations,
  getPronunciationsByCategory,
  getPronunciationStats,
  validateIPA,
  type PronunciationData,
  type PronunciationSearchResult,
} from "./pronunciation-guide";

// External Dictionary (Azure Translator + Google Translate)
export {
  translateText,
  dictionaryLookup,
  enrichUnknownTerms,
  getExternalDictionaryStatus,
} from "./external-dictionary-service";

// Swahili Grammar Engine
export {
  checkGrammar,
  analyzeSentence,
  detectNounClass,
  decomposeVerb,
  getGrammarRulesForPrompt,
  validateBankingSwahili,
  getCorrectPossessive,
  NOUN_CLASSES,
  type NounClassInfo,
  type VerbMorphology,
  type GrammarIssue,
  type GrammarCheckResult,
  type SentenceAnalysis,
} from "./swahili-grammar";

// External Dictionary Types
export type {
  ExternalTranslationResult,
  ExternalTranslation,
  DictionaryLookupResult,
  ExternalProvider,
  ExternalDictionaryConfig,
} from "./types";

// ── Atomic Document Decomposition Engine ──────────────────────────────
// Universal text/document decomposition: Text -> Paragraphs -> Sentences -> Phrases -> Tokens -> Morphemes
// Dictionary-verified, Zod-validated, sub-millisecond retrieval
export {
  // Core decomposition
  decomposeText,
  quickAnalyze,
  // Dictionary graph
  getDictionaryGraph,
  initializeDictionaryGraph,
  addDiscoveredTerm,
  // Translation validation
  validateTranslation,
  quickValidate,
  validateTranslationBatch,
  // Gap filling
  fillGaps,
  fillSingleGap,
  // Zod schemas (for external validation)
  DocumentAtomSchema,
  TokenSchema,
  MorphemeSchema,
  TranslationValidationSchema,
} from "./decomposition";

export type {
  DocumentAtom,
  Token as DecompositionToken,
  Morpheme as DecompositionMorpheme,
  Phrase as DecompositionPhrase,
  Sentence as DecompositionSentence,
  Paragraph as DecompositionParagraph,
  DictionaryNode,
  TranslationValidation,
  MorphologicalResult,
  GraphStats,
  DecompositionOptions,
  GapFillerConfig,
  GapFillResult,
  ValidationConfig,
} from "./decomposition";

// ── Swahili Voice Boost (ASR vocabulary, normalization, code-switching SSML) ──
export {
  getSwahiliVoiceBoostConfig,
  normalizeASROutput,
  generateSSMLForCodeSwitched,
  type VoiceBoostConfig,
  type PronunciationGuide,
} from "./swahili-voice-boost";
