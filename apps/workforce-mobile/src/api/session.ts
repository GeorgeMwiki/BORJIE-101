import AsyncStorage from '@react-native-async-storage/async-storage'

const TOKEN_KEY = 'borjie.auth.token.v1'

interface SessionCache {
  token: string | null
  loaded: boolean
}

const cache: SessionCache = { token: null, loaded: false }

async function ensureLoaded(): Promise<void> {
  if (cache.loaded) {
    return
  }
  try {
    const stored = await AsyncStorage.getItem(TOKEN_KEY)
    cache.token = stored
  } catch {
    cache.token = null
  } finally {
    cache.loaded = true
  }
}

export async function getAuthToken(): Promise<string | null> {
  await ensureLoaded()
  return cache.token
}

export async function setAuthToken(token: string | null): Promise<void> {
  cache.token = token
  cache.loaded = true
  try {
    if (token === null) {
      await AsyncStorage.removeItem(TOKEN_KEY)
      return
    }
    await AsyncStorage.setItem(TOKEN_KEY, token)
  } catch (error) {
    console.error('Failed to persist auth token:', error)
  }
}

export function getCachedAuthToken(): string | null {
  return cache.token
}
