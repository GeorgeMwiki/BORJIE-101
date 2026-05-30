/**
 * Swahili Intelligence Engine: Type Definitions
 *
 * Core types for the adaptive Swahili NLP system that learns from
 * every conversation, asks when it doesn't know, and gets smarter over time.
 */

// ── Morphological Types ────────────────────────────────────────────

export type NounClass =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 14
  | 15
  | 16
  | 17
  | 18;

export type PartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "preposition"
  | "conjunction"
  | "interjection"
  | "particle"
  | "demonstrative"
  | "numeral"
  | "unknown";

export type VerbTense =
  | "present" // na-
  | "past" // li-
  | "future" // ta-
  | "perfect" // me-
  | "habitual" // hu-
  | "conditional" // ki-/nge-
  | "consecutive" // ka-
  | "subjunctive" // -e final vowel
  | "imperative" // bare root
  | "negative" // ha-...-i
  | "unknown";

export type DerivationalSuffix =
  | "causative" // -ish-/-esh-
  | "passive" // -w-
  | "reciprocal" // -an-
  | "stative" // -ik-/-ek-
  | "applicative" // -i-/-e-
  | "reversive"; // -u-

export interface MorphemeBreakdown {
  readonly original: string;
  readonly negation: string | null;
  readonly subjectPrefix: string | null;
  readonly tenseMarker: string | null;
  readonly relativeMarker: string | null;
  readonly objectPrefix: string | null;
  readonly root: string;
  readonly derivationalSuffixes: readonly DerivationalSuffix[];
  readonly finalVowel: string | null;
  readonly nounClassPrefix: string | null;
  readonly nounClass: NounClass | null;
  readonly isVerb: boolean;
  readonly isNoun: boolean;
  readonly isCopular: boolean;
  readonly confidence: number; // 0-1 how confident we are in the decomposition
}

// ── Vocabulary Types ───────────────────────────────────────────────

export type VocabularySource =
  | "seed" // Pre-loaded from dictionaries
  | "community" // Verified by multiple users
  | "user_taught" // Single user taught us
  | "ai_inferred" // AI figured out from context
  | "dictionary"; // External dictionary lookup

export type VocabularyStatus =
  | "candidate" // Just submitted, unverified
  | "community_review" // Multiple users confirmed
  | "verified" // Passed confidence threshold
  | "rejected"; // Flagged as incorrect

export type Dialect =
  | "standard" // Kiswahili Sanifu (Tanzania standard)
  | "coastal" // Kiunguja (Zanzibar), Kimvita (Mombasa)
  | "sheng" // Urban youth slang (Nairobi origin)
  | "upcountry" // Interior/rural variations
  | "kenyan" // Kenyan Standard
  | "formal" // Academic/government register
  | "colloquial"; // Informal everyday speech

export interface VocabularyEntry {
  readonly id: string;
  readonly word: string;
  readonly root: string;
  readonly nounClass: NounClass | null;
  readonly partOfSpeech: PartOfSpeech;
  readonly definitionSw: string | null;
  readonly definitionEn: string | null;
  readonly examples: readonly VocabularyExample[];
  readonly morphemeBreakdown: MorphemeBreakdown | null;
  readonly source: VocabularySource;
  readonly confidence: number; // 0-1
  readonly usageCount: number;
  readonly dialect: Dialect;
  readonly domains: readonly string[]; // e.g. ['finance', 'agriculture']
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VocabularyExample {
  readonly sentence: string;
  readonly translation: string | null;
  readonly source: string; // 'conversation', 'corpus', 'dictionary'
}

export interface UserVocabularySubmission {
  readonly word: string;
  readonly definitionProvided: string;
  readonly contextSentence: string;
  readonly conversationId: string | null;
  readonly submittedBy: string | null; // user ID
}

// ── OOV Detection Types ────────────────────────────────────────────

export interface OOVDetectionResult {
  readonly token: string;
  readonly isKnown: boolean;
  readonly confidence: number;
  readonly morphemeBreakdown: MorphemeBreakdown | null;
  readonly rootFound: boolean;
  readonly suggestedMeaning: string | null;
  readonly needsClarification: boolean;
  readonly similarKnownWords: readonly string[];
}

export interface ClarificationRequest {
  readonly unknownWord: string;
  readonly contextSentence: string;
  readonly questionSw: string; // Swahili clarification question
  readonly questionEn: string; // English fallback
  readonly morphemeHint: MorphemeBreakdown | null;
}

// ── Learning Event Types ───────────────────────────────────────────

export type LearningEventType =
  | "first_encounter" // AI saw this word for the first time
  | "user_taught" // User explicitly explained the word
  | "context_inferred" // AI figured it out from context
  | "confirmed" // User confirmed AI's understanding
  | "corrected" // User corrected AI's misunderstanding
  | "dictionary_lookup"; // Found in external reference

export interface LearningEvent {
  readonly word: string;
  readonly vocabularyId: string | null;
  readonly eventType: LearningEventType;
  readonly userId: string | null;
  readonly conversationContext: string;
  readonly confidenceBefore: number;
  readonly confidenceAfter: number;
  readonly createdAt: string;
}

// ── Code-Switching Types ───────────────────────────────────────────

export type LanguageTag = "sw" | "en" | "sheng" | "mixed";

export interface TokenLanguageTag {
  readonly token: string;
  readonly language: LanguageTag;
  readonly confidence: number;
}

export interface CodeSwitchAnalysis {
  readonly tokens: readonly TokenLanguageTag[];
  readonly dominantLanguage: LanguageTag;
  readonly switchPoints: readonly number[]; // indices where language changes
  readonly mixingRatio: number; // 0 = pure one language, 1 = heavily mixed
}

// ── Engine Configuration ───────────────────────────────────────────

export interface SwahiliEngineConfig {
  readonly confidenceThresholdForClarification: number; // Below this, ask
  readonly confidenceThresholdForVerified: number; // Above this, trust
  readonly maxClarificationPerMessage: number; // Don't ask too many
  readonly enableCommunityLearning: boolean;
  readonly enableAutoInference: boolean;
  readonly priorityDomains: readonly string[]; // e.g. ['finance', 'agriculture']
}

export const DEFAULT_ENGINE_CONFIG: SwahiliEngineConfig = {
  confidenceThresholdForClarification: 0.3,
  confidenceThresholdForVerified: 0.8,
  maxClarificationPerMessage: 2,
  enableCommunityLearning: true,
  enableAutoInference: true,
  priorityDomains: ["finance", "agriculture", "credit", "business"],
};
