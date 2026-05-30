/**
 * Atomic Document Decomposition Types
 *
 * Zod-validated schemas that break ANY document or text into its smallest
 * retrievable atoms. This is the "DNA" of language processing:
 *
 * Document -> Paragraphs -> Sentences -> Phrases -> Tokens -> Morphemes
 *
 * Every level is validated, translated, and indexed for sub-millisecond retrieval.
 * Swahili agglutinative morphology is handled natively: a single word like
 * "walipokuwa" decomposes to {wa-li-po-ku-wa} with full grammatical metadata.
 *
 * This is the UNIVERSAL standard for document decomposition across the platform.
 * Whether it's a loan application, legal contract, or chat message, the same
 * atomic decomposition applies.
 *
 * @module decomposition/types
 */

import { z } from "zod";

// ============================================================================
// Morpheme — The Absolute Smallest Unit
// ============================================================================

export const MorphemeTypeSchema = z.enum([
  "prefix", // Noun class prefix, subject concord
  "tense_marker", // li, na, ta, me, etc.
  "object_infix", // wa, m, ki, etc.
  "root", // Core meaning carrier
  "derivational", // Causative (-ish-), applicative (-i-), passive (-w-)
  "final_vowel", // -a, -e, -i
  "possessive", // -angu, -ako, -ake
  "relative", // -o, -ye, -cho
  "negative", // ha-, si-, -to-
  "conjunction", // na, au, lakini
  "standalone", // Complete morpheme (English words, particles)
]);

export type MorphemeType = z.infer<typeof MorphemeTypeSchema>;

export const MorphemeSchema = z.object({
  /** The morpheme text itself */
  form: z.string().min(1),
  /** Grammatical type */
  type: MorphemeTypeSchema,
  /** What this morpheme means */
  gloss: z.string(),
  /** Noun class number if applicable (1-18) */
  nounClass: z.number().int().min(1).max(18).optional(),
  /** Tense if this is a tense marker */
  tense: z
    .enum([
      "past",
      "present",
      "future",
      "perfect",
      "habitual",
      "subjunctive",
      "conditional",
    ])
    .optional(),
  /** Person/number if subject/object marker */
  person: z.enum(["1sg", "2sg", "3sg", "1pl", "2pl", "3pl"]).optional(),
  /** Confidence that this decomposition is correct (0-1) */
  confidence: z.number().min(0).max(1),
});

export type Morpheme = z.infer<typeof MorphemeSchema>;

// ============================================================================
// Token — A Single Word with Full Linguistic Metadata
// ============================================================================

export const PartOfSpeechSchema = z.enum([
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "determiner",
  "numeral",
  "particle",
  "auxiliary",
  "copula",
  "unknown",
]);

export type PartOfSpeech = z.infer<typeof PartOfSpeechSchema>;

export const TokenSchema = z.object({
  /** Original text as it appears in source */
  surface: z.string().min(1),
  /** Lowercase normalized form */
  normalized: z.string().min(1),
  /** Dictionary root/lemma form */
  lemma: z.string(),
  /** Detected language */
  language: z.enum(["en", "sw", "mixed", "unknown"]),
  /** Part of speech */
  pos: PartOfSpeechSchema,
  /** Morpheme decomposition (especially for Swahili agglutinative words) */
  morphemes: z.array(MorphemeSchema),
  /** Direct translations (if known) */
  translations: z.object({
    en: z.string().optional(),
    sw: z.string().optional(),
  }),
  /** Dictionary match confidence (0 = not found, 1 = exact match) */
  dictionaryConfidence: z.number().min(0).max(1),
  /** Whether this token was verified against an authoritative dictionary */
  verified: z.boolean(),
  /** Source of the translation/verification */
  verificationSource: z.enum([
    "financial_dictionary", // Our 520-term financial dict
    "general_dictionary", // Kamusi/BAKITA/general vocab
    "grammar_engine", // Decomposed via swahili-grammar.ts
    "translation_memory", // Previously learned translation
    "external_api", // Google/Azure API
    "online_search", // Web search for unknown terms
    "ai_inference", // LLM-generated (lowest confidence)
    "unverified", // Not yet verified
  ]),
  /** Position in the original text */
  position: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }),
  /** Semantic domain tags */
  domains: z.array(z.string()).default([]),
  /** Is this a financial/banking term? */
  isFinancialTerm: z.boolean().default(false),
  /** Phonetic representation for TTS */
  phonetic: z.string().optional(),
});

export type Token = z.infer<typeof TokenSchema>;

// ============================================================================
// Phrase — A Meaningful Group of Tokens
// ============================================================================

export const PhraseTypeSchema = z.enum([
  "noun_phrase",
  "verb_phrase",
  "prepositional_phrase",
  "adjectival_phrase",
  "adverbial_phrase",
  "idiomatic",
  "financial_term", // Multi-word financial terms (e.g., "interest rate")
  "proper_noun", // Named entity
  "numeric_expression", // "TZS 5,000,000"
  "unknown",
]);

export type PhraseType = z.infer<typeof PhraseTypeSchema>;

export const PhraseSchema = z.object({
  /** The phrase text */
  text: z.string().min(1),
  /** Phrase type */
  type: PhraseTypeSchema,
  /** Component tokens */
  tokens: z.array(TokenSchema),
  /** Phrase-level translations */
  translations: z.object({
    en: z.string().optional(),
    sw: z.string().optional(),
  }),
  /** Whether the phrase has an idiomatic meaning different from literal */
  isIdiomatic: z.boolean().default(false),
  /** Confidence in phrase boundary detection */
  confidence: z.number().min(0).max(1),
});

export type Phrase = z.infer<typeof PhraseSchema>;

// ============================================================================
// Sentence — A Complete Thought
// ============================================================================

export const SentenceSchema = z.object({
  /** Original sentence text */
  text: z.string().min(1),
  /** Detected language */
  language: z.enum(["en", "sw", "mixed"]),
  /** Sentence type */
  type: z.enum(["declarative", "interrogative", "imperative", "exclamatory"]),
  /** Constituent phrases */
  phrases: z.array(PhraseSchema),
  /** All tokens (flat list for fast access) */
  tokens: z.array(TokenSchema),
  /** Complete sentence translation */
  translations: z.object({
    en: z.string().optional(),
    sw: z.string().optional(),
  }),
  /** Formality level */
  formality: z.enum(["formal", "neutral", "informal"]),
  /** Whether code-switching was detected */
  hasCodeSwitching: z.boolean(),
  /** Grammar quality score (0-1, from swahili-grammar engine) */
  grammarScore: z.number().min(0).max(1),
  /** Position in paragraph */
  index: z.number().int().min(0),
});

export type Sentence = z.infer<typeof SentenceSchema>;

// ============================================================================
// Paragraph — A Logical Text Block
// ============================================================================

export const ParagraphSchema = z.object({
  /** Original paragraph text */
  text: z.string(),
  /** Component sentences */
  sentences: z.array(SentenceSchema),
  /** Primary language */
  language: z.enum(["en", "sw", "mixed"]),
  /** Paragraph-level semantic summary */
  semanticTopic: z.string().optional(),
  /** Domain tags aggregated from tokens */
  domains: z.array(z.string()),
  /** Position in document */
  index: z.number().int().min(0),
});

export type Paragraph = z.infer<typeof ParagraphSchema>;

// ============================================================================
// DocumentAtom — The Complete Decomposition of ANY Document
// ============================================================================

export const DocumentAtomSchema = z.object({
  /** Unique decomposition ID */
  id: z.string(),
  /** Source document/text identifier */
  sourceId: z.string().optional(),
  /** Source type */
  sourceType: z.enum([
    "chat_message",
    "document_upload",
    "voice_transcript",
    "ui_text",
    "legal_document",
    "financial_statement",
    "loan_application",
    "certificate",
    "report",
    "email",
    "sms",
    "other",
  ]),
  /** Original raw text */
  rawText: z.string(),
  /** Detected primary language */
  primaryLanguage: z.enum(["en", "sw", "mixed"]),
  /** Paragraphs */
  paragraphs: z.array(ParagraphSchema),
  /** Statistics */
  stats: z.object({
    totalParagraphs: z.number().int(),
    totalSentences: z.number().int(),
    totalTokens: z.number().int(),
    totalMorphemes: z.number().int(),
    uniqueTokens: z.number().int(),
    verifiedTokens: z.number().int(),
    unverifiedTokens: z.number().int(),
    financialTerms: z.number().int(),
    swahiliTokens: z.number().int(),
    englishTokens: z.number().int(),
    dictionaryCoverage: z.number().min(0).max(1),
    grammarScore: z.number().min(0).max(1),
  }),
  /** Unresolved tokens (unknown words not in any dictionary) */
  unresolvedTokens: z.array(
    z.object({
      surface: z.string(),
      position: z.object({ start: z.number(), end: z.number() }),
      context: z.string(),
      suggestedTranslations: z.array(
        z.object({
          text: z.string(),
          source: z.string(),
          confidence: z.number(),
        }),
      ),
    }),
  ),
  /** Decomposition metadata */
  metadata: z.object({
    decomposedAt: z.string(),
    processingTimeMs: z.number(),
    engineVersion: z.string(),
    usedOnlineSearch: z.boolean(),
    usedNeuralFallback: z.boolean(),
  }),
});

export type DocumentAtom = z.infer<typeof DocumentAtomSchema>;

// ============================================================================
// Dictionary Graph Node — For Trie/Graph-Based Lookups
// ============================================================================

export const DictionaryNodeSchema = z.object({
  /** The word/morpheme */
  form: z.string(),
  /** Language */
  language: z.enum(["en", "sw"]),
  /** Part of speech */
  pos: PartOfSpeechSchema.optional(),
  /** Root/lemma form */
  lemma: z.string().optional(),
  /** Direct translations */
  translations: z.record(z.string(), z.string()),
  /** Morpheme decomposition (for Swahili) */
  morphemes: z.array(MorphemeSchema).optional(),
  /** Phonetic representation */
  phonetic: z.string().optional(),
  /** Definition */
  definition: z.string().optional(),
  /** Usage examples */
  examples: z.array(z.string()).default([]),
  /** Semantic domains */
  domains: z.array(z.string()).default([]),
  /** Frequency rank (lower = more common) */
  frequencyRank: z.number().int().optional(),
  /** Source of this entry */
  source: z.enum([
    "kamusi",
    "bakita",
    "financial_dictionary",
    "general_vocabulary",
    "learned",
    "external_api",
  ]),
  /** Related words */
  relatedWords: z.array(z.string()).default([]),
  /** Noun class (for Swahili nouns) */
  nounClass: z.number().int().min(1).max(18).optional(),
});

export type DictionaryNode = z.infer<typeof DictionaryNodeSchema>;

// ============================================================================
// Translation Validation Result
// ============================================================================

export const TranslationValidationSchema = z.object({
  /** Original text */
  original: z.string(),
  /** Translated text */
  translated: z.string(),
  /** Source language */
  sourceLang: z.enum(["en", "sw"]),
  /** Target language */
  targetLang: z.enum(["en", "sw"]),
  /** Overall validation status */
  status: z.enum(["verified", "partially_verified", "unverified", "rejected"]),
  /** Per-token verification results */
  tokenVerifications: z.array(
    z.object({
      sourceToken: z.string(),
      translatedToken: z.string(),
      verified: z.boolean(),
      verificationSource: z.string(),
      confidence: z.number().min(0).max(1),
      suggestion: z.string().optional(),
    }),
  ),
  /** Overall confidence */
  confidence: z.number().min(0).max(1),
  /** Grammar check result for the translated text */
  grammarScore: z.number().min(0).max(1),
  /** Suggested corrections */
  suggestions: z.array(z.string()),
});

export type TranslationValidation = z.infer<typeof TranslationValidationSchema>;
