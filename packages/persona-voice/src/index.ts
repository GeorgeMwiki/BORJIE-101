/**
 * `@borjie/persona-voice` — public surface (Wave M2).
 *
 * Same factual content, two voices. GUIDE — Mr. Mwikila does, the
 * user approves. LEARN — Mr. Mwikila teaches, the user does.
 * BALANCED — the default middle ground. The toggle is per-tenant +
 * per-user with a single click.
 *
 * Spec: Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md §§7–8.
 *
 * This package is pure text + decision logic. No LLM call, no
 * network, no database. The host wires a SQL adapter through the
 * `VoiceModeRepository` port.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export {
  VOICE_MODES,
  DEFAULT_VOICE_MODE,
  DEFAULT_VERBOSITY,
  type VoiceMode,
  type VerbosityLevel,
  type VoiceProfile,
  type ResponseDraft,
  type ResponseStyle,
  type ResponseStructure,
  type ModeSelectorContext,
  type VoiceModeRepository,
  PersonaVoiceError,
  voiceModeSchema,
  verbosityLevelSchema,
  voiceProfileUpsertSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Mode selector
// ---------------------------------------------------------------------------
export {
  LEARN_MASTERY_CEILING,
  GUIDE_MASTERY_FLOOR,
  masteryDefaultMode,
  defaultVerbosityForMode,
  resolveVoiceProfile,
  type ResolveModeDeps,
} from './mode/mode-selector.js';

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------
export {
  GUIDE_PREAMBLE,
  LEARN_PREAMBLE,
  BALANCED_PREAMBLE,
  GUIDE_TAIL,
  LEARN_TAIL,
  BALANCED_TAIL,
  styleResponse,
} from './styling/response-styler.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------
export { createInMemoryVoiceModeRepository } from './repositories/voice-mode-repository.js';
