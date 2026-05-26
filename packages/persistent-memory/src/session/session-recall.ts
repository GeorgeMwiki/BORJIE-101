/**
 * Session-recall — fetches the latest session-memory snapshot for a
 * thread and returns it iff still fresh (Wave 18GG).
 */

import type { SessionMemory, SessionMemoryRepository } from '../types.js';
import { isSessionMemoryFresh } from './ttl-policy.js';

export interface SessionRecallDeps {
  readonly repo: SessionMemoryRepository;
}

export type SessionRecallFn = (
  tenant_id: string,
  thread_id: string,
  now: Date,
) => Promise<SessionMemory | null>;

export function createSessionRecall(
  deps: SessionRecallDeps,
): SessionRecallFn {
  return async (tenant_id, thread_id, now) => {
    const found = await deps.repo.findByThread(tenant_id, thread_id);
    if (!found) return null;
    if (!isSessionMemoryFresh(found.expires_at, now)) return null;
    return found;
  };
}
