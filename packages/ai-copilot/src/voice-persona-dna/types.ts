/**
 * Voice-Persona DNA — Wave 28.
 *
 * Pinned persona profiles for every Mr. Mwikila sub-layer (head of
 * estates, property owner, tenant, vendor, regulator, lease applicant).
 *
 * The voice/ subtree holds provider plumbing (ElevenLabs, OpenAI, a
 * language-aware router). That layer does NOT carry opinionated tone,
 * pacing, vocabulary-register, greeting/closing, or taboo rules. When
 * the Brain produced replies those rules lived implicitly inside
 * prompts, which means the six personae × eight sub-layers had no
 * guaranteed voice consistency — a silent quality drop nobody could
 * detect until a tenant complained.
 *
 * This module pins them as data:
 *   - `VoicePersonaProfile` — the full DNA of a persona.
 *   - Per-persona greeting / closing / taboo lists so the Brain and the
 *     consistency-validator can both work off the same contract.
 *   - `codeSwitching` opt-in for EA markets where switching into Swahili
 *     for one or two phrases builds rapport.
 *   - `voiceBinding` so the VoiceRouter can resolve the ElevenLabs /
 *     OpenAI voice-id for the persona without hard-coding IDs in
 *     fifteen call-sites.
 */

/** BCP-47 locale string (e.g. 'en-US', 'sw-KE', 'ar-AE'). */
export type LocaleBCP47 = string;

export type PersonaTone =
  | 'formal'
  | 'casual'
  | 'warm'
  | 'precise'
  | 'authoritative';

export type VocabularyRegister =
  | 'literary'
  | 'professional'
  | 'conversational'
  | 'colloquial';

export type SentencePauseLength = 'short' | 'medium' | 'long';

export interface PersonaPace {
  readonly wordsPerMinute: number;
  readonly pausesAfterSentence: SentencePauseLength;
}

/**
 * Code-switching rules. Many EA tenants appreciate (and expect) a
 * landlord-voice that drops into Swahili for greetings or rapport
 * phrases. The rules here are NOT a free-form allow-list — they pin the
 * primary locale, the locales we allow as inserts, and the contexts
 * that trigger a switch (greeting, reassurance, etc.).
 */
export interface CodeSwitchingRules {
  readonly primary: LocaleBCP47;
  readonly allowedInserts: readonly LocaleBCP47[];
  readonly triggerContexts: readonly string[];
}

/**
 * Provider-level voice binding. Optional because the persona rules are
 * valuable even for text-only surfaces (WhatsApp, SMS, email drafting)
 * where there is no speech output.
 */
export interface VoiceBinding {
  readonly elevenLabsVoiceId?: string;
  readonly openAiVoice?: string;
}

/**
 * The full DNA of one Mr. Mwikila sub-layer persona. Frozen at module
 * load — callers MUST treat this as read-only.
 */
export interface VoicePersonaProfile {
  readonly personaId: string;
  readonly displayName: string;
  readonly tone: PersonaTone;
  readonly pace: PersonaPace;
  readonly vocabularyRegister: VocabularyRegister;
  readonly codeSwitching?: CodeSwitchingRules;
  /** ≥ 3 patterns; validated at module load. */
  readonly greetingPatterns: readonly string[];
  /** ≥ 3 patterns; validated at module load. */
  readonly closingPatterns: readonly string[];
  /** ≥ 5 things the persona must NEVER say (phrases, slang, slurs). */
  readonly taboos: readonly string[];
  readonly voiceBinding?: VoiceBinding;
}

// ---------------------------------------------------------------------------
// Consistency validator
// ---------------------------------------------------------------------------

export type PersonaViolationKind =
  | 'taboo_used'
  | 'register_too_casual'
  | 'register_too_formal'
  | 'pace_output_too_long'
  | 'pace_output_too_short'
  | 'missing_greeting'
  | 'missing_closing'
  | 'code_switch_out_of_context';

export interface PersonaViolation {
  readonly kind: PersonaViolationKind;
  readonly message: string;
  /** Optional quote from the output that triggered the violation. */
  readonly snippet?: string;
  /** 0-1 severity; consistency-validator weights low-severity less. */
  readonly severity: number;
}

export interface PersonaFitReport {
  /** 0 (terrible) - 1 (perfect). */
  readonly score: number;
  readonly violations: readonly PersonaViolation[];
  readonly suggestions: readonly string[];
}

// ---------------------------------------------------------------------------
// Drift detector
// ---------------------------------------------------------------------------

export interface PersonaFitSample {
  readonly tenantId: string;
  readonly personaId: string;
  readonly score: number;
  readonly timestamp: number;
}

export interface PersonaDriftAlert {
  readonly tenantId: string;
  readonly personaId: string;
  readonly windowSize: number;
  readonly averageScore: number;
  readonly threshold: number;
  readonly triggeredAt: number;
}
