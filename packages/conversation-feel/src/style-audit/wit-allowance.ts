/**
 * Wit allowance.
 *
 * Per session: at most 1 dry-observation moment is allowed (Mr. Mwikila's
 * measured, Jarvis-like personality). Never forced; only fires when:
 *   - the user has shown openness (not in distress, not formal)
 *   - the topic permits levity (not regulator-facing, not a loss event)
 *   - the register is right (small-talk or casual exchange)
 *
 * Distress + playful signals are matched in both English and Swahili. The
 * module only emits a tone hint — it never rewrites the reply, so the active
 * locale is untouched.
 *
 * References:
 *  - Provine, "Laughter: A Scientific Investigation" (2000) — comedic timing
 *    depends on conversational register.
 *  - Holmes + Marra, "Over the edge?" (2002) — workplace humour studies.
 */

import type { ConversationContext } from '../types.js';

export interface WitDecision {
  readonly allowed: boolean;
  readonly already_used_this_session: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly recommended_form: 'dry_aside' | 'callback' | 'deadpan' | null;
}

const DISTRESS_SIGNALS: ReadonlyArray<RegExp> = [
  /\b(panic|panicking|terrified|terrible|disaster|crisis|emergency|urgent|stressed|crying|broken)\b/i,
  /\b(lost (everything|my (job|licen[cs]e|business|claim|site)))\b/i,
  /\bcan'?t (sleep|eat|breathe|cope)\b/i,
  // Swahili distress
  /\b(hofu|wasiwasi|maafa|dharura|janga|nimechoka|nimevunjika|nimepoteza)\b/i,
];

const FORMAL_REGISTER: ReadonlyArray<RegExp> = [
  /\b(regulator|compliance|audit|legal counsel|inspector|royalty assessment)\b/i,
  /\b(written notice|formal complaint|fraud report)\b/i,
  // Swahili formal register
  /\b(mdhibiti|ukaguzi|sheria|notisi rasmi|malalamiko rasmi)\b/i,
];

const PLAYFUL_SIGNALS: ReadonlyArray<RegExp> = [
  /\b(haha|lol|😂|😄|😅|🙃|cheers|nice|hehe|jk)\b/i,
  /\b(curious|wondering|just wondering|hypothetically)\b/i,
  // Swahili playful
  /\b(haya|poa|safi|nashangaa|najiuliza)\b/i,
];

/** Pure: decide whether wit is allowed this turn. */
export function decideWit(
  ctx: ConversationContext,
  witUsedCount: number,
): WitDecision {
  const reasons: string[] = [];

  if (witUsedCount >= 1) {
    reasons.push('session_quota_exhausted');
    return blocked(reasons, true);
  }

  const userMsg = ctx.user_message ?? '';
  if (DISTRESS_SIGNALS.some((rx) => rx.test(userMsg))) {
    reasons.push('user_distress_detected');
    return blocked(reasons, false);
  }

  if (FORMAL_REGISTER.some((rx) => rx.test(userMsg))) {
    reasons.push('formal_register');
    return blocked(reasons, false);
  }

  // Public marketing traffic is too risky — we don't yet know the user state.
  if (ctx.surface === 'marketing') {
    reasons.push('public_marketing_surface_too_risky');
    return blocked(reasons, false);
  }

  // Need an openness signal: playful tone OR a small-talk turn.
  const playful = PLAYFUL_SIGNALS.some((rx) => rx.test(userMsg));
  const smalltalk = ctx.turn_kind === 'smalltalk';
  if (!playful && !smalltalk) {
    reasons.push('no_openness_signal');
    return blocked(reasons, false);
  }

  return {
    allowed: true,
    already_used_this_session: false,
    reasons: ['openness_signal_present', 'register_permits_levity'],
    recommended_form: playful ? 'dry_aside' : 'deadpan',
  };
}

function blocked(reasons: ReadonlyArray<string>, used: boolean): WitDecision {
  return {
    allowed: false,
    already_used_this_session: used,
    reasons,
    recommended_form: null,
  };
}

/**
 * Pure: produce the inline tone instruction that nudges the model toward a
 * single dry observation. Never forces a joke — instructs restraint.
 */
export function witInjection(decision: WitDecision): string | null {
  if (!decision.allowed) return null;
  return [
    'One dry-observation moment is allowed this turn. Use it only if it lands cleanly.',
    'Form: a brief sideways comment, never a setup-punchline joke.',
    'If nothing dry comes naturally, skip it. Forcing wit is worse than no wit.',
  ].join(' ');
}
