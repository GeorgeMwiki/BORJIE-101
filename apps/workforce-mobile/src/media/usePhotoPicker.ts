import { useCallback, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'

// See gh-issue #14: requires EAS dev build — expo-image-picker is a
// native module that uses the camera. In Expo Go the library picker
// works but launchCameraAsync requires a custom dev client.

export interface CapturedMedia {
  id: string
  uri: string
  width: number
  height: number
  mimeType: string
  capturedAt: number
}

export interface PhotoPickerState {
  pending: boolean
  error: string | null
}

function newId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function toMedia(asset: ImagePicker.ImagePickerAsset): CapturedMedia {
  return {
    id: newId(),
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType ?? 'image/jpeg',
    capturedAt: Date.now()
  }
}

export interface UsePhotoPickerResult {
  state: PhotoPickerState
  takePhoto: () => Promise<CapturedMedia | null>
  pickPhoto: () => Promise<CapturedMedia | null>
  takeVideo: (maxSeconds?: number) => Promise<CapturedMedia | null>
}

export function usePhotoPicker(): UsePhotoPickerResult {
  const [state, setState] = useState<PhotoPickerState>({
    pending: false,
    error: null
  })

  const ensureCameraPermission = useCallback(async (): Promise<boolean> => {
    const current = await ImagePicker.getCameraPermissionsAsync()
    if (current.granted) {
      return true
    }
    const next = await ImagePicker.requestCameraPermissionsAsync()
    return next.granted
  }, [])

  const takePhoto = useCallback(async (): Promise<CapturedMedia | null> => {
    setState({ pending: true, error: null })
    try {
      const granted = await ensureCameraPermission()
      if (!granted) {
        setState({ pending: false, error: 'permission_denied' })
        return null
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false
      })
      if (result.canceled || result.assets.length === 0) {
        setState({ pending: false, error: null })
        return null
      }
      const media = toMedia(result.assets[0]!)
      setState({ pending: false, error: null })
      return media
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setState({ pending: false, error: message })
      return null
    }
  }, [ensureCameraPermission])

  const pickPhoto = useCallback(async (): Promise<CapturedMedia | null> => {
    setState({ pending: true, error: null })
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7
      })
      if (result.canceled || result.assets.length === 0) {
        setState({ pending: false, error: null })
        return null
      }
      const media = toMedia(result.assets[0]!)
      setState({ pending: false, error: null })
      return media
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setState({ pending: false, error: message })
      return null
    }
  }, [])

  const takeVideo = useCallback(
    async (maxSeconds = 10): Promise<CapturedMedia | null> => {
      setState({ pending: true, error: null })
      try {
        const granted = await ensureCameraPermission()
        if (!granted) {
          setState({ pending: false, error: 'permission_denied' })
          return null
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          videoMaxDuration: maxSeconds,
          quality: 0.6
        })
        if (result.canceled || result.assets.length === 0) {
          setState({ pending: false, error: null })
          return null
        }
        const media = toMedia(result.assets[0]!)
        setState({ pending: false, error: null })
        return media
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setState({ pending: false, error: message })
        return null
      }
    },
    [ensureCameraPermission]
  )

  return { state, takePhoto, pickPhoto, takeVideo }
}
