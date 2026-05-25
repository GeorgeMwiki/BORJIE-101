import * as LocalAuthentication from 'expo-local-authentication'

export type BiometricResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'not_enrolled' | 'cancelled' | 'failed' }

export async function authenticateForSignature(prompt: string): Promise<BiometricResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  if (!hasHardware) {
    return { ok: false, reason: 'unavailable' }
  }
  const enrolled = await LocalAuthentication.isEnrolledAsync()
  if (!enrolled) {
    return { ok: false, reason: 'not_enrolled' }
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: 'Cancel',
    fallbackLabel: '',
    disableDeviceFallback: false
  })
  if (result.success) {
    // The native module does not surface a verifiable token; we synthesise
    // a marker that the backend can correlate via session + timestamp.
    return { ok: true, token: `bio-${Date.now()}` }
  }
  // ExpoLocalAuthentication types differ slightly across SDKs; check both
  // success: false and the `error` field defensively.
  const error =
    typeof result === 'object' && result !== null && 'error' in result ? (result as { error?: string }).error : undefined
  if (error === 'user_cancel' || error === 'system_cancel' || error === 'app_cancel') {
    return { ok: false, reason: 'cancelled' }
  }
  return { ok: false, reason: 'failed' }
}
