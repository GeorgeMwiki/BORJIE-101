/**
 * Pure normalisers for the brain-teach SSE stream's trust + Theory-of-Mind
 * frames (`debate_metadata`, `brain_state`, `auto_authorized`,
 * `affective_profile`).
 *
 * Extracted from `HomeChatTeach` so the wire-format parsing is unit-tested
 * without standing up the full fetch/stream component — mirrors the
 * blackboard-bridge test pattern (test the bridge function, not the
 * fetch machinery). Every normaliser is defensive: a malformed frame
 * yields `null` rather than a half-formed badge, so a wire drift can
 * never crash the renderer or surface a partial trust signal.
 */

import type { BorjieAffectiveProfile } from './BorjieDynamicHints';

/**
 * Trust badge — emitted (`debate_metadata`) when a high-stakes turn ran
 * the multi-model debate. Renders "Verified ✓ N-model" above the bubble.
 */
export interface DebateBadge {
  readonly verified: boolean;
  readonly winnerProvider: string;
  readonly winnerModel: string;
  readonly contenders: number;
}

/**
 * Degraded-brain pill — emitted (`brain_state`) only when the provider
 * ladder failed on the last 2+ consecutive turns for this owner.
 */
export interface BrainStateBadge {
  readonly label: string;
  readonly consecutiveFailures: number;
}

/**
 * Auto-authorized companion — emitted (`auto_authorized`) when the brain
 * executed a low-risk action without a confirmation gate.
 */
export interface AutoAuthorizedBadge {
  readonly action: string;
  readonly rationale: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Map the brain's `affective_profile` frame onto the five-axis profile
 * `<ProactiveHint>` consumes. Returns null unless every axis is a finite
 * number — a partial read must never surface a half-formed hint.
 */
export function normaliseAffectiveProfile(
  value: unknown,
): BorjieAffectiveProfile | null {
  if (!isRecord(value)) return null;
  const axis = (k: string): number | null => {
    const n = value[k];
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const frustration = axis('frustration');
  const comprehension = axis('comprehension');
  const anxiety = axis('anxiety');
  const trust = axis('trust');
  const urgency = axis('urgency');
  if (
    frustration === null ||
    comprehension === null ||
    anxiety === null ||
    trust === null ||
    urgency === null
  ) {
    return null;
  }
  const lastUpdated =
    typeof value.lastUpdated === 'string'
      ? value.lastUpdated
      : new Date().toISOString();
  return { frustration, comprehension, anxiety, trust, urgency, lastUpdated };
}

/**
 * Map the `debate_metadata` frame onto the trust badge. Returns null for
 * a non-record payload; otherwise always a badge (the frame only fires
 * when a real debate ran).
 */
export function normaliseDebateBadge(value: unknown): DebateBadge | null {
  if (!isRecord(value)) return null;
  const winner = isRecord(value.winner) ? value.winner : {};
  const trace = isRecord(value.trace) ? value.trace : {};
  const responses = (trace as { responses?: unknown }).responses;
  return {
    verified: value.verified === true,
    winnerProvider:
      typeof winner.provider === 'string' ? winner.provider : '',
    winnerModel: typeof winner.model === 'string' ? winner.model : '',
    contenders: Array.isArray(responses) ? responses.length : 0,
  };
}

/**
 * Map the `brain_state` frame onto the degraded pill. Returns null unless
 * `degraded === true` — healthy turns carry the frame only in the final
 * `done` summary, never as a standalone degraded signal.
 */
export function normaliseBrainStateBadge(
  value: unknown,
): BrainStateBadge | null {
  if (!isRecord(value)) return null;
  if (value.degraded !== true) return null;
  return {
    label:
      typeof value.label === 'string'
        ? value.label
        : 'Brain operating in degraded mode',
    consecutiveFailures:
      typeof value.consecutiveFailures === 'number'
        ? value.consecutiveFailures
        : 0,
  };
}

/**
 * Map the `auto_authorized` frame onto the companion badge. The action
 * may sit at the top level or nested under `payload`. Returns null when
 * no action string is present.
 */
export function normaliseAutoAuthorized(
  value: unknown,
): AutoAuthorizedBadge | null {
  if (!isRecord(value)) return null;
  const inner = isRecord(value.payload) ? value.payload : value;
  const action = typeof inner.action === 'string' ? inner.action : '';
  if (!action) return null;
  const rationale =
    typeof inner.rationale === 'string'
      ? inner.rationale
      : typeof inner.reason === 'string'
        ? inner.reason
        : null;
  return { action, rationale };
}
