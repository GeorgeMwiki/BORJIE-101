/**
 * In-memory USSD session store (LP-25).
 *
 * Reference {@link UssdSessionStore} backed by a Map. Used by tests and by
 * single-replica dev. Production hosts inject a Drizzle/Supabase-backed store
 * (the `ussd_sessions` table) instead — this package has no DB dependency.
 *
 * @module @borjie/ussd-engine/in-memory-store
 */

import {
  USSD_SESSION_TIMEOUT_SECONDS,
  type UssdLanguage,
  type UssdSession,
  type UssdSessionState,
} from './types.js';
import { systemClock, type UssdClock, type UssdSessionStore } from './ports.js';

export interface InMemoryStoreOptions {
  readonly clock?: UssdClock;
}

export function createInMemorySessionStore(
  options: InMemoryStoreOptions = {},
): UssdSessionStore {
  const clock = options.clock ?? systemClock;
  const sessions = new Map<string, UssdSession>();

  const get = async (sessionId: string): Promise<UssdSession | null> =>
    sessions.get(sessionId) ?? null;

  const create = async (session: UssdSession): Promise<UssdSession> => {
    sessions.set(session.sessionId, session);
    return session;
  };

  const update = async (
    sessionId: string,
    updates: {
      readonly state?: UssdSessionState;
      readonly language?: UssdLanguage;
      readonly data?: Readonly<Record<string, unknown>>;
    },
  ): Promise<UssdSession> => {
    const current = sessions.get(sessionId);
    if (!current) {
      throw new Error(`ussd session not found: ${sessionId}`);
    }
    const now = clock.now();
    const next: UssdSession = {
      ...current,
      ...(updates.state !== undefined ? { state: updates.state } : {}),
      ...(updates.language !== undefined ? { language: updates.language } : {}),
      ...(updates.data !== undefined ? { data: updates.data } : {}),
      lastActivityAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + USSD_SESSION_TIMEOUT_SECONDS * 1000).toISOString(),
    };
    sessions.set(sessionId, next);
    return next;
  };

  const end = async (sessionId: string): Promise<void> => {
    sessions.delete(sessionId);
  };

  return { get, create, update, end };
}
