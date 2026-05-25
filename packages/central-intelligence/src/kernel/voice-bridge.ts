/**
 * Voice bridge — augment a kernel `PersonaIdentity` with a voice
 * profile from `@borjie/voice-persona-dna` (which lives at
 * `packages/ai-copilot/src/voice-persona-dna` in this monorepo).
 *
 * The voice-persona-dna package owns tone / pace / vocabulary register
 * / code-switching / greeting + closing / taboos for every Mr. Mwikila
 * sub-layer voice. The kernel owns the cognitive identity (opening
 * statement, first-person noun, taboos rendered into the system
 * prompt). The bridge marries them: a base persona is wrapped with a
 * voice section, and the persona's `toneGuidance` is augmented with a
 * one-line description of the voice profile so downstream prompt
 * assembly picks it up automatically.
 *
 * voice-persona-dna is duck-typed locally (same pattern used by
 * `dp-cohort-source.ts` for `DpAggregator`) so this package does not
 * compile-time depend on it. The production composition root binds a
 * concrete profile at runtime.
 */

import type { PersonaIdentity } from './identity.js';
import { selectPersona } from './identity.js';
import type { ThoughtRequest } from './kernel-types.js';

// ─────────────────────────────────────────────────────────────────────
// Duck-typed voice-persona-dna surface — keep in sync with
// @borjie/voice-persona-dna (currently
// packages/ai-copilot/src/voice-persona-dna/types.ts).
// ─────────────────────────────────────────────────────────────────────

export type VoiceTone =
  | 'formal'
  | 'casual'
  | 'warm'
  | 'precise'
  | 'authoritative';

export type VoiceVocabularyRegister =
  | 'literary'
  | 'professional'
  | 'conversational'
  | 'colloquial';

export type VoiceSentencePauseLength = 'short' | 'medium' | 'long';

export interface VoicePace {
  readonly wordsPerMinute: number;
  readonly pausesAfterSentence: VoiceSentencePauseLength;
}

export interface VoiceCodeSwitchingRules {
  readonly primary: string;
  readonly allowedInserts: ReadonlyArray<string>;
  readonly triggerContexts: ReadonlyArray<string>;
}

export interface VoiceBindingHint {
  readonly elevenLabsVoiceId?: string;
  readonly openAiVoice?: string;
}

/**
 * Duck-typed shape of `VoicePersonaProfile` from voice-persona-dna.
 * Read-only; the bridge never mutates the profile.
 */
export interface VoiceProfile {
  readonly personaId: string;
  readonly displayName: string;
  readonly tone: VoiceTone;
  readonly pace: VoicePace;
  readonly vocabularyRegister: VoiceVocabularyRegister;
  readonly codeSwitching?: VoiceCodeSwitchingRules;
  readonly greetingPatterns: ReadonlyArray<string>;
  readonly closingPatterns: ReadonlyArray<string>;
  readonly taboos: ReadonlyArray<string>;
  readonly voiceBinding?: VoiceBindingHint;
}

/**
 * Stable identifiers for the voice-persona-dna profiles. The bridge
 * does not hold references to the profile objects themselves — those
 * live in voice-persona-dna and are resolved by id at runtime — but
 * we publish the id list as a closed string-literal union so the
 * surface→voice map below is exhaustive at compile time.
 */
export type VoiceProfileId =
  | 'mr-mwikila-head'
  | 'mr-mwikila-owner'
  | 'mr-mwikila-tenant'
  | 'mr-mwikila-vendor'
  | 'mr-mwikila-regulator'
  | 'mr-mwikila-applicant';

// ─────────────────────────────────────────────────────────────────────
// Voiced persona — base PersonaIdentity + voice section.
// ─────────────────────────────────────────────────────────────────────

/**
 * The voice section attached to a `PersonaIdentity` once a profile has
 * been applied. We carry a normalised subset of the profile so the
 * kernel never has to re-resolve the profile downstream.
 */
export interface PersonaVoiceSection {
  readonly profileId: string;
  readonly displayName: string;
  readonly tone: VoiceTone;
  readonly pace: VoicePace;
  readonly vocabularyRegister: VoiceVocabularyRegister;
  readonly primaryLocale: string | null;
  readonly allowedLocaleInserts: ReadonlyArray<string>;
  readonly codeSwitchTriggerContexts: ReadonlyArray<string>;
  /** Sample greeting + closing patterns, kept short for prompt budget. */
  readonly greetingPatterns: ReadonlyArray<string>;
  readonly closingPatterns: ReadonlyArray<string>;
  /** voice-persona-dna taboo list (additive — kernel taboos still apply). */
  readonly voiceTaboos: ReadonlyArray<string>;
  readonly voiceBinding: VoiceBindingHint | null;
}

/**
 * A `PersonaIdentity` augmented with a voice profile. The base persona
 * is preserved verbatim except for `toneGuidance`, which is appended
 * with a one-line voice description. Original identity remains
 * untouched (immutability — see test 2).
 */
export interface VoicedPersona extends PersonaIdentity {
  readonly voice: PersonaVoiceSection;
}

// ─────────────────────────────────────────────────────────────────────
// Surface defaults — pick a sensible voice per surface.
// ─────────────────────────────────────────────────────────────────────

export type Surface = ThoughtRequest['surface'];

/**
 * Default voice profile for each surface. Choices:
 *
 *   tenant-app         — `tenant` voice. Warm, conversational, EA-
 *                         friendly Swahili code-switching for rapport.
 *   owner-portal       — `owner` voice. Warm + professional; owners
 *                         expect a relationship tone.
 *   estate-manager-app — `head` voice. Formal, precise, professional;
 *                         operators want data first, no filler.
 *   admin-portal       — `head` voice as well — the agency admin runs
 *                         the business; data-first matches.
 *   platform-hq        — `regulator` voice. Measured, formal English,
 *                         literary register; the HQ sovereign answers
 *                         like a regulator-grade institution.
 *   classroom          — `applicant` voice. Warm, scaffolded, never a
 *                         pressure pitch.
 *   marketing          — `applicant` voice as well — public-facing
 *                         warmth without sales-pitch register.
 */
export const SURFACE_DEFAULT_VOICE: Readonly<Record<Surface, VoiceProfileId>> =
  Object.freeze({
    'tenant-app': 'mr-mwikila-tenant',
    'owner-portal': 'mr-mwikila-owner',
    'estate-manager-app': 'mr-mwikila-head',
    'admin-portal': 'mr-mwikila-head',
    'platform-hq': 'mr-mwikila-regulator',
    classroom: 'mr-mwikila-applicant',
    marketing: 'mr-mwikila-applicant',
  });

// ─────────────────────────────────────────────────────────────────────
// applyVoiceProfile — wrap a base persona with a voice section and
// augment toneGuidance. Pure function; never mutates inputs.
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose a one-line voice description for the system prompt. Kept
 * short on purpose — the kernel renders this verbatim into the
 * identity preamble alongside the persona's existing toneGuidance.
 */
function describeVoice(profile: VoiceProfile): string {
  const localePart = profile.codeSwitching
    ? ` Primary locale: ${profile.codeSwitching.primary}; may insert ${profile.codeSwitching.allowedInserts.join(', ')} for ${profile.codeSwitching.triggerContexts.join(' / ')}.`
    : '';
  return [
    `Voice profile: ${profile.displayName}`,
    `(tone: ${profile.tone}; register: ${profile.vocabularyRegister}; pace: ${profile.pace.wordsPerMinute}wpm, ${profile.pace.pausesAfterSentence} pauses).${localePart}`,
  ].join(' ');
}

function buildVoiceSection(profile: VoiceProfile): PersonaVoiceSection {
  // Cap greeting/closing samples at 3 to bound prompt budget. The
  // voice-persona-dna profiles already cap at ≥3, so this is a
  // ceiling rather than a floor.
  const greetingSamples = profile.greetingPatterns.slice(0, 3);
  const closingSamples = profile.closingPatterns.slice(0, 3);

  return {
    profileId: profile.personaId,
    displayName: profile.displayName,
    tone: profile.tone,
    pace: profile.pace,
    vocabularyRegister: profile.vocabularyRegister,
    primaryLocale: profile.codeSwitching?.primary ?? null,
    allowedLocaleInserts: profile.codeSwitching?.allowedInserts ?? [],
    codeSwitchTriggerContexts: profile.codeSwitching?.triggerContexts ?? [],
    greetingPatterns: greetingSamples,
    closingPatterns: closingSamples,
    voiceTaboos: profile.taboos,
    voiceBinding: profile.voiceBinding ?? null,
  };
}

/**
 * Augment a base persona with a voice profile. Returns a NEW persona;
 * the input `base` is never mutated. The voice's tone description is
 * appended to `toneGuidance` so existing prompt assembly automatically
 * picks it up; everything else on the base persona is preserved.
 */
export function applyVoiceProfile(
  base: PersonaIdentity,
  profile: VoiceProfile,
): VoicedPersona {
  const voiceLine = describeVoice(profile);
  const augmentedToneGuidance =
    base.toneGuidance.length > 0
      ? `${base.toneGuidance} ${voiceLine}`
      : voiceLine;

  return {
    id: base.id,
    displayName: base.displayName,
    openingStatement: base.openingStatement,
    toneGuidance: augmentedToneGuidance,
    taboos: base.taboos,
    violationSignals: base.violationSignals,
    firstPersonNoun: base.firstPersonNoun,
    voice: buildVoiceSection(profile),
  };
}

// ─────────────────────────────────────────────────────────────────────
// personaWithVoice — selectPersona + applyVoiceProfile in one shot.
// Resolves the surface-default voice profile through an injected
// resolver; falls back to the base persona untouched if the resolver
// returns null (e.g. voice-persona-dna not yet bound at composition).
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolver that turns a `VoiceProfileId` into a `VoiceProfile`. The
 * production wiring binds this to voice-persona-dna's `getProfile`.
 * Tests pass a stub.
 */
export type VoiceProfileResolver = (
  profileId: VoiceProfileId,
) => VoiceProfile | null;

/**
 * Default resolver — returns null for every id. The composition root
 * is expected to inject a resolver that delegates to
 * voice-persona-dna's `getProfile`. Until that wiring lands,
 * `personaWithVoice` returns the base persona untouched (no voice
 * section attached) so unwired callers don't crash.
 */
const NULL_RESOLVER: VoiceProfileResolver = () => null;

let activeResolver: VoiceProfileResolver = NULL_RESOLVER;

/**
 * Bind a voice-profile resolver. The production composition root
 * calls this once at startup with voice-persona-dna's `getProfile`.
 * Tests call it with a stub. Returns the previous resolver so tests
 * can restore.
 */
export function setVoiceProfileResolver(
  resolver: VoiceProfileResolver,
): VoiceProfileResolver {
  const previous = activeResolver;
  activeResolver = resolver;
  return previous;
}

/**
 * Combine `selectPersona` with `applyVoiceProfile` in one call. The
 * surface drives both the persona AND the default voice profile.
 *
 * If no resolver is bound (or the resolver returns null), the base
 * persona is returned untouched but cast to `VoicedPersona` with a
 * synthetic voice section that reflects the kernel persona itself —
 * never undefined, so callers can rely on `result.voice` always being
 * present.
 */
export function personaWithVoice(req: ThoughtRequest): VoicedPersona {
  const base = selectPersona(req);
  const profileId = SURFACE_DEFAULT_VOICE[req.surface];
  const profile = activeResolver(profileId);
  if (profile === null) {
    // Fallback: return the base persona with a degenerate voice
    // section that reflects the kernel persona itself. Keeps the
    // result type stable for downstream consumers.
    return {
      id: base.id,
      displayName: base.displayName,
      openingStatement: base.openingStatement,
      toneGuidance: base.toneGuidance,
      taboos: base.taboos,
      violationSignals: base.violationSignals,
      firstPersonNoun: base.firstPersonNoun,
      voice: {
        profileId,
        displayName: base.displayName,
        tone: 'warm',
        pace: { wordsPerMinute: 160, pausesAfterSentence: 'medium' },
        vocabularyRegister: 'professional',
        primaryLocale: null,
        allowedLocaleInserts: [],
        codeSwitchTriggerContexts: [],
        greetingPatterns: [],
        closingPatterns: [],
        voiceTaboos: [],
        voiceBinding: null,
      },
    };
  }
  return applyVoiceProfile(base, profile);
}
