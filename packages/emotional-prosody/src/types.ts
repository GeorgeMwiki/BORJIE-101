// =============================================================================
// Emotional Prosody Intelligence — Type Definitions
// Governs voice warmth, frustration detection, and emotional state tracking
//
// Ported verbatim from LitFin src/core/emotional-prosody/types.ts.
// =============================================================================

// ---------------------------------------------------------------------------
// Emotion taxonomy
// ---------------------------------------------------------------------------

export type EmotionType =
  | "curious"
  | "confident"
  | "confused"
  | "frustrated"
  | "excited"
  | "bored"
  | "anxious"
  | "determined"
  | "neutral";

export type EmotionTrigger =
  | "quiz_fail"
  | "quiz_success"
  | "concept_struggle"
  | "breakthrough"
  | "repeated_error"
  | "long_pause"
  | "short_response"
  | "help_request"
  | "topic_change"
  | "session_start";

export type EmotionTrend = "improving" | "stable" | "declining";

// ---------------------------------------------------------------------------
// Snapshots & State
// ---------------------------------------------------------------------------

export interface EmotionSnapshot {
  readonly emotion: EmotionType;
  readonly timestamp: Date;
  readonly trigger: EmotionTrigger;
  readonly intensity: number; // 0-10
}

export interface EmotionalState {
  readonly current: EmotionType;
  readonly confidence: number; // 0-1
  readonly trend: EmotionTrend;
  readonly frustrationLevel: number; // 0-10
  readonly engagementLevel: number; // 0-10
  readonly history: readonly EmotionSnapshot[];
}

// ---------------------------------------------------------------------------
// Voice configuration (ElevenLabs-aligned)
// ---------------------------------------------------------------------------

export type VoiceWarmth = "cool" | "neutral" | "warm" | "very_warm";

export type VoiceEmphasis = "gentle" | "normal" | "encouraging" | "celebratory";

export interface VoiceConfig {
  readonly stability: number; // 0-1 (ElevenLabs parameter)
  readonly similarityBoost: number; // 0-1
  readonly style: number; // 0-1
  readonly speakingRate: number; // 0.5-2.0
  readonly pitch: number; // semitone adjustment (-12 to +12)
  readonly warmth: VoiceWarmth;
  readonly emphasis: VoiceEmphasis;
}

// ---------------------------------------------------------------------------
// Text modifiers — injected phrases for emotional tone
// ---------------------------------------------------------------------------

export type TextModifierType =
  | "encouragement"
  | "empathy"
  | "celebration"
  | "reassurance"
  | "challenge";

export type TextInsertPosition = "before" | "after" | "inline";

export interface TextModifier {
  readonly type: TextModifierType;
  readonly insert: TextInsertPosition;
  readonly templates: readonly string[];
  readonly templatesSw: readonly string[];
}

// ---------------------------------------------------------------------------
// Prosody profile — composite state
// ---------------------------------------------------------------------------

export interface ProsodyProfile {
  readonly emotionalState: EmotionalState;
  readonly voiceConfig: VoiceConfig;
  readonly textModifiers: readonly TextModifier[];
}

// ---------------------------------------------------------------------------
// Frustration signal types
// ---------------------------------------------------------------------------

export type FrustrationSignalKind =
  | "terse_response"
  | "repeated_incorrect"
  | "long_pause"
  | "explicit_frustration"
  | "question_repetition"
  | "response_degradation"
  | "topic_avoidance"
  | "swahili_frustration";

export interface FrustrationSignal {
  readonly kind: FrustrationSignalKind;
  readonly weight: number; // 0-1 contribution to frustration score
  readonly evidence: string; // what triggered the signal
  readonly detectedAt: Date;
}

// ---------------------------------------------------------------------------
// Message analysis input
// ---------------------------------------------------------------------------

export interface AnalyzableMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: Date;
}

export interface QuizResult {
  readonly conceptId: string;
  readonly correct: boolean;
  readonly timestamp: Date;
  readonly attemptNumber: number;
}

export interface FrustrationContext {
  readonly recentQuizResults: readonly QuizResult[];
  readonly currentConcept: string;
  readonly sessionDurationMs: number;
  readonly language: "en" | "sw";
}

// ---------------------------------------------------------------------------
// Prompt context output
// ---------------------------------------------------------------------------

export interface ProsodyPromptContext {
  readonly toneDirective: string;
  readonly sentenceLengthGuide: "short" | "medium" | "normal";
  readonly encouragementLevel: "none" | "light" | "moderate" | "heavy";
  readonly referencePriorSuccess: boolean;
  readonly suggestAlternativeApproach: boolean;
  readonly textPrefixes: readonly string[];
  readonly textSuffixes: readonly string[];
  readonly teachingAdjustments: readonly string[];
}

// ---------------------------------------------------------------------------
// ElevenLabs API parameter shape
// ---------------------------------------------------------------------------

export interface ElevenLabsVoiceParams {
  readonly stability: number;
  readonly similarity_boost: number;
  readonly style: number;
  readonly use_speaker_boost: boolean;
}

export interface ElevenLabsGenerationParams {
  readonly voice_settings: ElevenLabsVoiceParams;
  readonly model_id: string;
}
