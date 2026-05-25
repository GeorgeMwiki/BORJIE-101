import { useCallback, useEffect, useRef, useState } from 'react'
import { Audio } from 'expo-av'

// TODO: requires EAS dev build — expo-av records via native audio modules
// and won't function in the basic Expo Go preview without permissions
// configured by the dev-client build.

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error'

export interface VoiceRecording {
  uri: string
  durationMs: number
  recordedAt: number
}

export interface VoiceRecorderState {
  status: RecorderStatus
  durationMs: number
  recording: VoiceRecording | null
  error: string | null
}

const INITIAL_STATE: VoiceRecorderState = {
  status: 'idle',
  durationMs: 0,
  recording: null,
  error: null
}

export interface UseVoiceRecorderResult {
  state: VoiceRecorderState
  start: () => Promise<void>
  stop: () => Promise<VoiceRecording | null>
  reset: () => void
}

/**
 * Thin wrapper around expo-av Recording. One active recording at a time.
 * Caller controls UX (button shows mic / stop). Returns the saved uri so the
 * shift report payload can reference it.
 */
export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [state, setState] = useState<VoiceRecorderState>(INITIAL_STATE)
  const recordingRef = useRef<Audio.Recording | null>(null)

  const reset = useCallback((): void => {
    recordingRef.current = null
    setState(INITIAL_STATE)
  }, [])

  const start = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'requesting', error: null }))
    try {
      const permission = await Audio.requestPermissionsAsync()
      if (!permission.granted) {
        setState({
          status: 'error',
          durationMs: 0,
          recording: null,
          error: 'permission_denied'
        })
        return
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true
      })
      const recording = new Audio.Recording()
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )
      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording) {
          setState((prev) => ({
            ...prev,
            status: 'recording',
            durationMs: status.durationMillis
          }))
        }
      })
      await recording.startAsync()
      recordingRef.current = recording
      setState({
        status: 'recording',
        durationMs: 0,
        recording: null,
        error: null
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setState({ status: 'error', durationMs: 0, recording: null, error: message })
    }
  }, [])

  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    const recording = recordingRef.current
    if (!recording) {
      return null
    }
    try {
      await recording.stopAndUnloadAsync()
      const uri = recording.getURI()
      if (!uri) {
        recordingRef.current = null
        setState({
          status: 'error',
          durationMs: 0,
          recording: null,
          error: 'no_recording_uri'
        })
        return null
      }
      const status = await recording.getStatusAsync()
      const durationMs = status.durationMillis ?? 0
      const result: VoiceRecording = {
        uri,
        durationMs,
        recordedAt: Date.now()
      }
      recordingRef.current = null
      setState({
        status: 'stopped',
        durationMs,
        recording: result,
        error: null
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      recordingRef.current = null
      setState({ status: 'error', durationMs: 0, recording: null, error: message })
      return null
    }
  }, [])

  useEffect(() => {
    return () => {
      // Best-effort cleanup if the screen unmounts mid-recording.
      const active = recordingRef.current
      if (active) {
        void active.stopAndUnloadAsync().catch(() => undefined)
      }
    }
  }, [])

  return { state, start, stop, reset }
}
