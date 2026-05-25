import AsyncStorage from '@react-native-async-storage/async-storage'

const TOKEN_KEY = 'borjie.auth.token'

let memoryToken: string | null = null

export async function getAuthToken(): Promise<string | null> {
  if (memoryToken) {
    return memoryToken
  }
  try {
    const stored = await AsyncStorage.getItem(TOKEN_KEY)
    if (stored) {
      memoryToken = stored
    }
    return memoryToken
  } catch {
    return null
  }
}

export async function setAuthToken(token: string): Promise<void> {
  memoryToken = token
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore persistence failure — memory copy still valid
  }
}

export async function clearAuthToken(): Promise<void> {
  memoryToken = null
  try {
    await AsyncStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}
