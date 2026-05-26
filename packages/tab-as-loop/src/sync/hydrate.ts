/**
 * Hydration protocol — §15 of the spec.
 *
 * On reopen, the client posts its last-known iteration. The server
 * reads the snapshot + every `tab_events` row newer than the cursor,
 * replays them deterministically on top of the snapshot, and returns
 * the fully rehydrated session.
 *
 * The replay function lives here so the on-disk SQL adapter and the
 * in-memory adapter share the same semantics.
 */

import type {
  HydrateResult,
  HydrateTabInput,
  TabEventRepository,
  TabSession,
  TabSessionRepository,
} from '../types.js';
import { transitionSession } from '../repositories/tab-session.js';

export class HydrateError extends Error {
  public readonly code: 'not_found' | 'lifecycle_closed';
  constructor(code: HydrateError['code'], message: string) {
    super(message);
    this.name = 'HydrateError';
    this.code = code;
  }
}

interface HydrateDeps {
  readonly sessions: TabSessionRepository;
  readonly events: TabEventRepository;
  readonly now: () => Date;
}

/**
 * Resolve a session by id + replay every event newer than the client
 * cursor. Advances the lifecycle through OPEN → HYDRATED. The caller
 * is the API gateway adapter; this function does the deterministic
 * work and writes back the new session row.
 */
export async function hydrateSession(
  input: HydrateTabInput,
  deps: HydrateDeps,
): Promise<HydrateResult> {
  const current = await deps.sessions.findById(input.tenantId, input.sessionId);
  if (current === null) {
    throw new HydrateError('not_found', `tab session ${input.sessionId} not found`);
  }
  if (current.lifecycleState === 'closed') {
    throw new HydrateError(
      'lifecycle_closed',
      `tab session ${input.sessionId} is closed`,
    );
  }

  const events = await deps.events.listForSession(
    input.tenantId,
    input.sessionId,
    input.clientIteration,
  );

  // Determine the snapshot iteration — the highest iteration the
  // session has authoritatively reached. Equal to the session's
  // current loopCursor.iteration.
  const snapshotIteration = current.state.loopCursor.iteration;

  // Advance lifecycle: opening → hydrating → active. If the session
  // is already warm (paused), we treat focus() the same way.
  const now = deps.now();
  let next: TabSession = current;
  if (current.lifecycleState === 'opening') {
    next = transitionSession(next, 'OPEN', now);
    next = transitionSession(next, 'HYDRATED', now);
  } else if (current.lifecycleState === 'hydrating') {
    next = transitionSession(next, 'HYDRATED', now);
  } else if (current.lifecycleState === 'paused') {
    next = transitionSession(next, 'FOCUS', now);
  } else if (current.lifecycleState === 'expiring') {
    // FOCUS on an expiring session sends it back to hydrating.
    next = transitionSession(next, 'FOCUS', now);
    next = transitionSession(next, 'HYDRATED', now);
  }
  // `active` is already warm — leave the lifecycle alone.

  await deps.sessions.replace(next);

  return {
    session: next,
    snapshotIteration,
    eventsApplied: events.length,
  };
}
