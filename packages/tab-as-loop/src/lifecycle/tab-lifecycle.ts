/**
 * Tab lifecycle state machine.
 *
 * Wave M5. Encodes the §13 diagram:
 *
 *     opening → hydrating → active ↔ paused → expiring → closed
 *
 * Transitions outside of the listed edges throw. The state machine is
 * pure — no I/O, no logging — so it can be exercised in unit tests
 * deterministically. Storage + telemetry are layered on top by the
 * repositories.
 */

import type { TabLifecycleState } from '../types.js';

export type TabLifecycleEvent =
  | 'OPEN'
  | 'HYDRATED'
  | 'BLUR'
  | 'FOCUS'
  | 'TTL_ELAPSED'
  | 'PURGE'
  | 'CLOSE';

export interface InvalidTransition {
  readonly from: TabLifecycleState;
  readonly via: TabLifecycleEvent;
}

export class TabLifecycleError extends Error {
  public readonly transition: InvalidTransition;
  constructor(transition: InvalidTransition) {
    super(
      `tab-lifecycle: invalid transition from ${transition.from} via ${transition.via}`,
    );
    this.name = 'TabLifecycleError';
    this.transition = transition;
  }
}

/**
 * Pure transition function. Returns the next lifecycle state, or
 * throws `TabLifecycleError` for an illegal edge.
 *
 * The machine is intentionally strict: an OPEN event on an `active`
 * row is a logic error in the caller, not a no-op. Callers that want
 * idempotent semantics layer their own guard above this function.
 */
export function transitionTabLifecycle(
  from: TabLifecycleState,
  via: TabLifecycleEvent,
): TabLifecycleState {
  switch (from) {
    case 'opening':
      if (via === 'OPEN') return 'hydrating';
      break;
    case 'hydrating':
      if (via === 'HYDRATED') return 'active';
      break;
    case 'active':
      if (via === 'BLUR') return 'paused';
      if (via === 'CLOSE') return 'closed';
      break;
    case 'paused':
      if (via === 'FOCUS') return 'active';
      if (via === 'TTL_ELAPSED') return 'expiring';
      if (via === 'CLOSE') return 'closed';
      break;
    case 'expiring':
      if (via === 'PURGE') return 'closed';
      if (via === 'FOCUS') return 'hydrating';
      break;
    case 'closed':
      // No outgoing edges — terminal.
      break;
    default: {
      const exhaustive: never = from;
      throw new Error(`tab-lifecycle: unreachable state ${String(exhaustive)}`);
    }
  }
  throw new TabLifecycleError({ from, via });
}

/**
 * Convenience predicate — `true` if the row is in one of the warm
 * states (active OR paused). These are the only states from which the
 * client can usefully send deltas.
 */
export function isWarm(state: TabLifecycleState): boolean {
  return state === 'active' || state === 'paused';
}

/**
 * Convenience predicate — `true` if the row is past usable life.
 */
export function isTerminal(state: TabLifecycleState): boolean {
  return state === 'closed';
}

/**
 * Lifecycle-driven derivation: should the row be moved to the
 * expiring state given the current clock + the row's ttl?
 */
export function shouldExpire(
  state: TabLifecycleState,
  pausedAt: Date | null,
  expiresAt: Date,
  now: Date,
): boolean {
  if (state !== 'paused') return false;
  if (pausedAt === null) return false;
  return now.getTime() >= expiresAt.getTime();
}
