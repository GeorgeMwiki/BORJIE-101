/**
 * Tool lifecycle state machine.
 *
 * ON_DEMAND_INTERNAL_SOFTWARE_SPEC §4: transitions enforced are
 * draft → staged → live → archived (with the obvious early-exit
 * paths to archived). Archive is terminal.
 *
 * T2 authority tools require an explicit owner-sign before going
 * live; this module surfaces that requirement via `requiresOwnerSign`.
 * The caller (UI layer / mutation-authority gate) verifies the sign
 * is present before invoking `transition(..., 'live')`.
 *
 * Pure functions. No I/O. Deterministic.
 */

import type {
  AuthorityTier,
  InternalTool,
  ToolLifecycle,
} from '../types.js';
import { INTERNAL_TOOL_CONSTANTS } from '../types.js';

export interface TransitionAttempt {
  readonly from: ToolLifecycle;
  readonly to: ToolLifecycle;
  readonly authorityTier: AuthorityTier;
  /** Owner-sign artifact required when going from `staged` → `live` on T2. */
  readonly ownerSign?: string;
}

export type TransitionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Check whether a transition is allowed by the state machine + the
 * authority gate. Does NOT mutate any storage — the caller persists
 * the transition via `InternalToolRepository.transitionLifecycle`.
 */
export function canTransition(attempt: TransitionAttempt): TransitionResult {
  const allowed = INTERNAL_TOOL_CONSTANTS.ALLOWED_TRANSITIONS[attempt.from];
  if (allowed === undefined || !allowed.includes(attempt.to)) {
    return {
      ok: false,
      reason: `transition ${attempt.from} → ${attempt.to} is not allowed`,
    };
  }
  if (
    attempt.from === 'staged' &&
    attempt.to === 'live' &&
    attempt.authorityTier === 'T2'
  ) {
    if (attempt.ownerSign === undefined || attempt.ownerSign.length === 0) {
      return {
        ok: false,
        reason:
          'T2 tools require a non-empty ownerSign before staged → live',
      };
    }
  }
  return { ok: true };
}

/**
 * Determine whether a given lifecycle transition requires an owner
 * sign artifact. UI layers call this to render the appropriate
 * approval modal.
 */
export function requiresOwnerSign(
  from: ToolLifecycle,
  to: ToolLifecycle,
  authorityTier: AuthorityTier,
): boolean {
  return from === 'staged' && to === 'live' && authorityTier === 'T2';
}

/**
 * Convenience guard: is the tool in a state that allows execution?
 * Only `live` tools are runnable.
 */
export function isRunnable(tool: InternalTool): boolean {
  return tool.lifecycleState === INTERNAL_TOOL_CONSTANTS.RUNNABLE_LIFECYCLE;
}
