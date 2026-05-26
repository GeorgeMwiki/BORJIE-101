/**
 * Mode selector — given a `(tenant_id, user_id)` and an optional
 * surface mastery hint, returns the current `VoiceProfile`.
 *
 * Resolution order (spec §§4.3, 6, 7):
 *   1. Tenant-level admin policy override (compliance).
 *   2. Stored per-user preference.
 *   3. Mastery-tier heuristic for first-encounter default.
 *   4. Hard default — BALANCED, verbosity 2.
 *
 * Pure given the repository lookup result; mastery-tier mapping is
 * inlined here so unit tests can exercise it without I/O.
 */

import {
  DEFAULT_VERBOSITY,
  DEFAULT_VOICE_MODE,
  type ModeSelectorContext,
  type VerbosityLevel,
  type VoiceMode,
  type VoiceModeRepository,
  type VoiceProfile,
} from '../types.js';

/** Mastery score below which LEARN is the recommended default. */
export const LEARN_MASTERY_CEILING = 0.7;
/** Mastery score above which GUIDE is the recommended default. */
export const GUIDE_MASTERY_FLOOR = 0.7;

/**
 * Mastery-tier mapping for first-encounter default (spec §6).
 *
 *   mastery < 0.7 → LEARN (scaffolding helps)
 *   mastery ≥ 0.7 → GUIDE (the user can supervise)
 */
export function masteryDefaultMode(masteryScore: number): VoiceMode {
  if (Number.isNaN(masteryScore)) return DEFAULT_VOICE_MODE;
  if (masteryScore < LEARN_MASTERY_CEILING) return 'learn';
  if (masteryScore >= GUIDE_MASTERY_FLOOR) return 'guide';
  return DEFAULT_VOICE_MODE;
}

/**
 * Hard-default verbosity for a given mode.
 *   GUIDE   → 2 (terse — action-first)
 *   LEARN   → 3 (slightly verbose — Socratic prompts need room)
 *   BALANCED→ 2
 */
export function defaultVerbosityForMode(mode: VoiceMode): VerbosityLevel {
  if (mode === 'learn') return 3;
  return DEFAULT_VERBOSITY;
}

export interface ResolveModeDeps {
  readonly repo: VoiceModeRepository;
  readonly clock: () => Date;
}

/**
 * Async resolver — wraps the repository lookup, applies the cascade.
 */
export async function resolveVoiceProfile(
  deps: ResolveModeDeps,
  ctx: ModeSelectorContext,
): Promise<VoiceProfile> {
  // 1. Tenant policy override.
  if (ctx.tenant_policy_default) {
    return {
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id,
      mode: ctx.tenant_policy_default,
      verbosity_level: defaultVerbosityForMode(ctx.tenant_policy_default),
      updated_at: deps.clock().toISOString(),
    };
  }

  // 2. Stored per-user preference.
  const stored = await deps.repo.get(ctx.tenant_id, ctx.user_id);
  if (stored) return stored;

  // 3. Mastery-tier heuristic.
  if (typeof ctx.surface_mastery === 'number') {
    const inferred = masteryDefaultMode(ctx.surface_mastery);
    return {
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id,
      mode: inferred,
      verbosity_level: defaultVerbosityForMode(inferred),
      updated_at: deps.clock().toISOString(),
    };
  }

  // 4. Hard default.
  return {
    tenant_id: ctx.tenant_id,
    user_id: ctx.user_id,
    mode: DEFAULT_VOICE_MODE,
    verbosity_level: DEFAULT_VERBOSITY,
    updated_at: deps.clock().toISOString(),
  };
}
