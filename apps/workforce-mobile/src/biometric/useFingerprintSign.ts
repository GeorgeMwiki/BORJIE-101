import { useCallback, useState } from 'react'
import * as LocalAuthentication from 'expo-local-authentication'

// TODO: requires EAS dev build — expo-local-authentication needs the native
// biometric module. Falls back to a stub "sign" if hardware is absent so
// developers without a device can still exercise the flow.

export interface FingerprintResult {
  signedAt: number
  method: 'fingerprint' | 'face' | 'passcode' | 'stub'
}

export type FingerprintStatus = 'idle' | 'requesting' | 'success' | 'error'

export interface FingerprintState {
  status: FingerprintStatus
  error: string | null
  result: FingerprintResult | null
}

const INITIAL_STATE: FingerprintState = {
  status: 'idle',
  error: null,
  result: null
}

export interface UseFingerprintSignResult {
  state: FingerprintState
  sign: (promptMessage?: string) => Promise<FingerprintResult | null>
  reset: () => void
}

async function detectMethod(): Promise<FingerprintResult['method']> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'face'
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'fingerprint'
    }
    return 'passcode'
  } catch {
    return 'stub'
  }
}

/**
 * Single biometric "sign" prompt. Returns the result so call sites can stamp
 * a queued write or sign-off entry with proof of confirmation.
 */
export function useFingerprintSign(): UseFingerprintSignResult {
  const [state, setState] = useState<FingerprintState>(INITIAL_STATE)

  const reset = useCallback((): void => {
    setState(INITIAL_STATE)
  }, [])

  const sign = useCallback(
    async (promptMessage?: string): Promise<FingerprintResult | null> => {
      setState({ status: 'requesting', error: null, result: null })
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync()
        const isEnrolled = await LocalAuthentication.isEnrolledAsync()
        if (!hasHardware || !isEnrolled) {
          const fallback: FingerprintResult = {
            signedAt: Date.now(),
            method: 'stub'
          }
          setState({ status: 'success', error: null, result: fallback })
          return fallback
        }
        const outcome = await LocalAuthentication.authenticateAsync({
          promptMessage: promptMessage ?? 'Confirm fingerprint',
          cancelLabel: 'Cancel',
          disableDeviceFallback: false
        })
        if (!outcome.success) {
          const message =
            'error' in outcome && typeof outcome.error === 'string'
              ? outcome.error
              : 'cancelled'
          setState({ status: 'error', error: message, result: null })
          return null
        }
        const method = await detectMethod()
        const result: FingerprintResult = { signedAt: Date.now(), method }
        setState({ status: 'success', error: null, result })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setState({ status: 'error', error: message, result: null })
        return null
      }
    },
    []
  )

  return { state, sign, reset }
}
