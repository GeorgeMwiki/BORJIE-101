/**
 * Persistent persona session store for buyer-mobile.
 *
 * Backed by @react-native-async-storage/async-storage so that the
 * active persona binding survives app reload, cold start, and OS
 * background swaps. Without this, every relaunch dropped the
 * persona — a blocker for the live pilot.
 *
 * Key format: `borjie.persona.{namespace}.{sessionId}` where
 * namespace is 'buyer' (this app) or 'workforce' (sibling app).
 *
 * Failure mode: storage errors are quietly swallowed. A get failure
 * returns null (treated as "no persona bound, ask the user"); a set
 * failure is a no-op. This matches the pre-existing in-memory store
 * contract — neither throws — and keeps the UI thread unblocked.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ActivePersonaSessionStore } from '@borjie/persona-runtime'

const KEY_PREFIX = 'borjie.persona'

function keyFor(namespace: string, sessionId: string): string {
  return `${KEY_PREFIX}.${namespace}.${sessionId}`
}

export function createAsyncStoragePersonaStore(
  namespace: string
): ActivePersonaSessionStore {
  return {
    async setActive({ sessionId, personaId }) {
      try {
        await AsyncStorage.setItem(keyFor(namespace, sessionId), personaId)
      } catch {
        // swallow — see file header
      }
    },
    async getActive({ sessionId }) {
      try {
        const value = await AsyncStorage.getItem(keyFor(namespace, sessionId))
        return value ?? null
      } catch {
        return null
      }
    }
  }
}
