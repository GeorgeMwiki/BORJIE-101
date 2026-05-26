/**
 * Persona Voice — public type surface (Wave M2).
 *
 * Companion to Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md
 * (§§7–8). Every type is immutable. Mode changes produce a new
 * `VoiceProfile` projection — never an in-place mutation.
 *
 * The styling layer is pure text transformation. No network, no
 * database calls. Mode resolution is host-wired through the
 * `VoiceModeRepository` port.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Modes + verbosity
// ---------------------------------------------------------------------------

export const VOICE_MODES = ['guide', 'learn', 'balanced'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

/** Verbosity dial 1 (terse) … 5 (most verbose). Default 2. */
export type VerbosityLevel = 1 | 2 | 3 | 4 | 5;

/** Default mode when nothing is stored — balanced is the safe middle. */
export const DEFAULT_VOICE_MODE: VoiceMode = 'balanced';
/** Default verbosity dial when nothing is stored. */
export const DEFAULT_VERBOSITY: VerbosityLevel = 2;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface VoiceProfile {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly mode: VoiceMode;
  readonly verbosity_level: VerbosityLevel;
  readonly updated_at: string;
}

export interface ResponseDraft {
  /** Free-form body (typically markdown). The styler wraps this. */
  readonly body: string;
  /** Optional action attached to the draft — approve / review etc. */
  readonly action?: {
    readonly kind: 'approve' | 'review' | 'walk_through' | 'dismiss';
    readonly label: string;
  };
  /** Optional inline citations carried through unchanged. */
  readonly citations?: ReadonlyArray<{
    readonly title: string;
    readonly url?: string;
  }>;
  /** Optional pre-computed clarifier questions for LEARN mode. */
  readonly clarifier_questions?: ReadonlyArray<string>;
}

export interface ResponseStyle {
  readonly mode: VoiceMode;
  readonly verbosity_level: VerbosityLevel;
  /** The fully-styled text Mr. Mwikila would say. */
  readonly text: string;
  /** Mode-aware structural metadata for the chat-ui renderer. */
  readonly structure: ResponseStructure;
  readonly action?: {
    readonly kind: 'approve' | 'review' | 'walk_through' | 'dismiss';
    readonly label: string;
  };
  readonly citations?: ReadonlyArray<{
    readonly title: string;
    readonly url?: string;
  }>;
}

export interface ResponseStructure {
  /** TRUE in GUIDE — the artifact + approve button render first. */
  readonly artifact_first: boolean;
  /** TRUE in LEARN — the explanation renders first, artifact at bottom. */
  readonly explanation_first: boolean;
  /** TRUE in LEARN — render Socratic clarifier prompts. */
  readonly include_clarifiers: boolean;
  /** TRUE when the user can collapse the reasoning section. */
  readonly collapsible_reasoning: boolean;
}

// ---------------------------------------------------------------------------
// Context used by the mode selector
// ---------------------------------------------------------------------------

export interface ModeSelectorContext {
  readonly tenant_id: string;
  readonly user_id: string;
  /** Optional surface override — e.g. 'tab:tumemadini_filing'. */
  readonly surface_id?: string;
  /**
   * Tenant-level policy default. If set, this overrides the stored
   * per-user mode (used for compliance-mandated LEARN mode).
   */
  readonly tenant_policy_default?: VoiceMode;
  /**
   * Optional mastery score in [0, 1] for the current surface. The
   * default chooser uses this to bias new users toward LEARN.
   */
  readonly surface_mastery?: number;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface VoiceModeRepository {
  get(tenant_id: string, user_id: string): Promise<VoiceProfile | null>;
  upsert(profile: VoiceProfile): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PersonaVoiceError extends Error {
  public override readonly name = 'PersonaVoiceError';
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const voiceModeSchema = z.enum(VOICE_MODES);
export const verbosityLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const voiceProfileUpsertSchema = z.object({
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  mode: voiceModeSchema,
  verbosity_level: verbosityLevelSchema,
});
