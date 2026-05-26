/**
 * `@borjie/swahili-linguistics` — public surface (Wave 19H).
 *
 * The morphology + grammar + dialect intelligence layer that lets
 * Mr. Mwikila understand and produce Swahili at native-speaker
 * quality. Companion to Wave 19F (the audio path) and Wave 19G (the
 * voice persona).
 *
 * Spec: Docs/DESIGN/SWAHILI_LINGUISTICS_SOTA_SPEC.md
 */

// Types
export {
  type NounClass,
  type Register,
  type Dialect,
  type Morpheme,
  type MorphemeSlot,
  type PosTag,
  type Citation,
  type SwahiliTerm,
  type NounAnalysis,
  type VerbAnalysis,
  type DialectScore,
  type DialectDetectionResult,
  type ConcordViolation,
  type ConcordCheckResult,
  type SwahiliTermRow,
  type SwahiliMorphologyCacheRow,
  type SwahiliDialectSignalRow,
  type SwahiliTermsRepository,
  type SwahiliMorphologyCacheRepository,
  type SwahiliDialectSignalsRepository,
  NOUN_CLASSES,
  REGISTERS,
  DIALECTS,
  MORPHEME_SLOTS,
  POS_TAGS,
  SwahiliLinguisticsError,
  nounClassSchema,
  registerSchema,
  dialectSchema,
} from './types.js';

// Morphology
export {
  detectNounClass,
  derivePluralClass,
  derivePluralSurface,
} from './morphology/noun-class-detector.js';
export { analyzeVerb } from './morphology/verb-analyzer.js';
export {
  segmentMorphemes,
  type SegmentationResult,
} from './morphology/morpheme-segmenter.js';
export {
  checkSubjectConcord,
  expectedSubjectConcord,
} from './morphology/concord-checker.js';

// Dialect + register
export { detectDialect } from './dialect/dialect-detector.js';
export { classifyRegister } from './dialect/register-classifier.js';

// Glossary
export { MINING_TERMS_SEED } from './glossary/mining-terms.js';
export {
  createGlossaryLookup,
  type GlossaryLookup,
} from './glossary/glossary-lookup.js';

// Tokenizer
export {
  tokenize,
  tokenizeWord,
  detokenize,
  type Token,
} from './tokenize/swahili-tokenizer.js';

// Repositories
export {
  createInMemorySwahiliTermsRepository,
  createSqlSwahiliTermsRepository,
} from './repositories/terms.js';
export {
  createInMemoryMorphologyCacheRepository,
  createSqlMorphologyCacheRepository,
} from './repositories/morphology-cache.js';
export {
  createInMemoryDialectSignalsRepository,
  createSqlDialectSignalsRepository,
  type InMemoryDialectSignalsDeps,
} from './repositories/dialect-signals.js';
export type { SqlRunner } from './repositories/sql-runner.js';

// Audit-chain
export {
  computeSwahiliAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';
