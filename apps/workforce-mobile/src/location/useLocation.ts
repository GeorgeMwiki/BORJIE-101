import { useCallback, useEffect, useState } from 'react'
import * as Location from 'expo-location'

// TODO: requires EAS dev build — expo-location is a native module and won't
// work in Expo Go. In Expo Go we degrade to permission denied and the screen
// shows the "GPS unavailable" UX.

export interface Coordinates {
  latitude: number
  longitude: number
  accuracy: number | null
  capturedAt: number
}

export type LocationStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'error'

export interface LocationState {
  status: LocationStatus
  coords: Coordinates | null
  error: string | null
}

const INITIAL_STATE: LocationState = {
  status: 'idle',
  coords: null,
  error: null
}

export interface UseLocationOptions {
  auto?: boolean
}

/**
 * Request foreground GPS permission and capture a single position. Auto mode
 * fires on mount; otherwise call `capture()` when the user taps a button.
 */
export function useLocation(options: UseLocationOptions = {}): {
  state: LocationState
  capture: () => Promise<Coordinates | null>
} {
  const [state, setState] = useState<LocationState>(INITIAL_STATE)

  const capture = useCallback(async (): Promise<Coordinates | null> => {
    setState((prev) => ({ ...prev, status: 'requesting', error: null }))
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (permission.status !== 'granted') {
        setState({ status: 'denied', coords: null, error: 'permission_denied' })
        return null
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      })
      const coords: Coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: position.timestamp
      }
      setState({ status: 'granted', coords, error: null })
      return coords
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setState({ status: 'error', coords: null, error: message })
      return null
    }
  }, [])

  useEffect(() => {
    if (!options.auto) {
      return
    }
    void capture()
  }, [options.auto, capture])

  return { state, capture }
}
