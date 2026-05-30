/**
 * Shared types for the Language Intelligence module.
 *
 * This module powers Swahili-English language detection, spelling correction,
 * translation memory, and vocabulary learning across the Borjie platform.
 */

// ============================================================================
// Language Detection
// ============================================================================

export type SupportedLanguage = 'en' | 'sw'

export type CodeSwitchingPattern =
  | 'sw_frame_en_terms'   // Swahili sentence with English technical terms
  | 'en_frame_sw_terms'   // English sentence with Swahili words
  | 'alternating'         // Alternating between languages
  | 'none'                // Single language throughout

export type FormalityLevel = 'formal' | 'neutral' | 'informal'

export interface LanguageDetectionResult {
  readonly primaryLanguage: SupportedLanguage | 'mixed'
  readonly swahiliRatio: number
  readonly englishRatio: number
  readonly confidence: number
  readonly codeSwitchingDetected: boolean
  readonly codeSwitchingPattern: CodeSwitchingPattern
  readonly formalityLevel: FormalityLevel
  readonly detectedSwahiliWords: readonly string[]
  readonly detectedEnglishFinancialTerms: readonly string[]
  readonly suggestedResponseLanguage: SupportedLanguage | 'mixed'
}

// ============================================================================
// Spelling Correction
// ============================================================================

export type SpellingCorrectionType = 'typo' | 'phonetic' | 'regional_variation' | 'informal'

export interface SpellingCorrection {
  readonly original: string
  readonly corrected: string
  readonly position: number
  readonly confidence: number
  readonly type: SpellingCorrectionType
}

export interface SpellingCorrectionResult {
  readonly correctedText: string
  readonly corrections: readonly SpellingCorrection[]
  readonly hadCorrections: boolean
}

// ============================================================================
// Translation Memory
// ============================================================================

export type TranslationSource =
  | 'dictionary'          // From static dictionary file
  | 'user_conversation'   // Learned from user message
  | 'ai_generated'        // Extracted from AI response
  | 'officer_correction'  // Corrected by loan officer
  | 'external_api'        // Retrieved from Azure Translator / Google Translate

export interface TranslationMemoryEntry {
  readonly id: string
  readonly sourceText: string
  readonly sourceLang: SupportedLanguage
  readonly translatedText: string
  readonly targetLang: SupportedLanguage
  readonly context: string
  readonly confidence: number
  readonly observationCount: number
  readonly lastObservedAt: string
  readonly source: TranslationSource
}

// ============================================================================
// Vocabulary Learning
// ============================================================================

export interface ObservedTranslation {
  readonly translation: string
  readonly targetLang: SupportedLanguage
  readonly confidence: number
  readonly count: number
}

export interface LearnedVocabulary {
  readonly word: string
  readonly language: SupportedLanguage
  readonly observedTranslations: readonly ObservedTranslation[]
  readonly contexts: readonly string[]
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly totalOccurrences: number
}

// ============================================================================
// Dictionary Entry Types (for JSON data files)
// ============================================================================

export interface FinancialDictionaryEntry {
  readonly id: string
  readonly en: string
  readonly sw: string
  readonly phonetic_sw: string
  readonly category: string
  readonly definition_en: string
  readonly definition_sw: string
  readonly example_en: string
  readonly example_sw: string
  readonly related_terms: readonly string[]
  readonly frequency: 'high' | 'medium' | 'low'
  readonly difficulty: 'basic' | 'intermediate' | 'advanced'
  readonly context_tags: readonly string[]
}

export interface GeneralVocabularyEntry {
  readonly id: string
  readonly sw: string
  readonly en: string
  readonly phonetic_sw: string
  readonly usage_context: 'greeting' | 'question' | 'connector' | 'exclamation' | 'filler' | 'number' | 'time' | 'business'
  readonly formality: 'formal' | 'neutral' | 'informal' | 'slang'
  readonly region: 'national' | 'dar' | 'arusha' | 'mwanza' | 'dodoma' | 'mbeya' | 'zanzibar'
  readonly frequency: 'high' | 'medium' | 'low'
}

export interface SpellingCorrectionEntry {
  readonly incorrect: string
  readonly correct: string
  readonly type: SpellingCorrectionType
  readonly frequency: 'common' | 'occasional' | 'rare'
}

// ============================================================================
// User Language Profile
// ============================================================================

export type LanguageMixingPattern =
  | 'english_only'
  | 'swahili_only'
  | 'code_switching'
  | 'swahili_dominant'

export interface UserLanguageProfile {
  readonly userId: string
  readonly preferredLanguage: SupportedLanguage
  readonly mixingPattern: LanguageMixingPattern
  readonly formalityPreference: FormalityLevel
  readonly vocabularyLevel: 'basic' | 'intermediate' | 'advanced'
  readonly region: string | null
  readonly interactionCount: number
}

// ============================================================================
// External Dictionary / Translation API
// ============================================================================

export type ExternalProvider = 'azure' | 'google'

export interface ExternalTranslation {
  readonly text: string
  readonly language: SupportedLanguage
  readonly confidence: number
  readonly partOfSpeech?: string
  readonly examples?: readonly string[]
  readonly backTranslation?: string
}

export interface ExternalTranslationResult {
  readonly translations: readonly ExternalTranslation[]
  readonly provider: ExternalProvider
  readonly cached: boolean
  readonly sourceText: string
  readonly sourceLang: SupportedLanguage
  readonly targetLang: SupportedLanguage
}

export interface DictionaryLookupResult {
  readonly term: string
  readonly language: SupportedLanguage
  readonly translations: readonly {
    readonly displayTarget: string
    readonly posTag: string
    readonly confidence: number
    readonly prefixWord: string
    readonly backTranslations: readonly string[]
  }[]
  readonly provider: ExternalProvider
}

export interface ExternalDictionaryConfig {
  readonly azureKey?: string
  readonly azureRegion?: string
  readonly googleKey?: string
}
