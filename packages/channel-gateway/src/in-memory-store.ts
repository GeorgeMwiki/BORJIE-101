/**
 * In-memory conversation store (LP-25).
 *
 * Reference {@link ConversationStore} for tests + single-replica dev. The
 * production host injects a Redis/Upstash-backed store with a TTL so state
 * is shared across replicas and expires on its own.
 *
 * @module @borjie/channel-gateway/in-memory-store
 */

import type { ConversationState } from './types.js';
import type { ConversationStore } from './ports.js';

export function createInMemoryConversationStore(): ConversationStore {
  const states = new Map<string, ConversationState>();
  return {
    get: async (id) => states.get(id) ?? null,
    put: async (state) => {
      states.set(state.conversationId, state);
    },
    remove: async (id) => {
      states.delete(id);
    },
  };
}
