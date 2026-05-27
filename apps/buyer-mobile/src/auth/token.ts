import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'borjie.buyer.auth.token.v2'

let memoryToken: string | null = null

/**
 * Read the current access token. Prefers the in-memory copy; falls back to
 * the SecureStore on first call (cold start / app restart). The mirror is
 * needed because the Supabase client owns its own session storage — this
 * file is used by the legacy `apiFetch` Authorization header and is kept
 * in sync via `setAuthToken` from the AuthProvider.
 */
export async function getAuthToken(): Promise<string | null> {
  if (memoryToken) {
    return memoryToken
  }
  try {
    const stored = await SecureStore.getItemAsync(TOKEN_KEY)
    if (stored) {
      memoryToken = stored
    }
    return memoryToken
  } catch {
    return null
  }
}

export async function setAuthToken(token: string | null): Promise<void> {
  if (token === null) {
    memoryToken = null
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY)
    } catch {
      // ignore — memory copy still cleared
    }
    return
  }
  memoryToken = token
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token)
  } catch {
    // ignore persistence failure — memory copy still valid
  }
}

export async function clearAuthToken(): Promise<void> {
  await setAuthToken(null)
}
