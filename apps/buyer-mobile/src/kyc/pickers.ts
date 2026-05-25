import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'

export type ImagePickerResult =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly reason: 'denied' | 'cancelled' | 'failed' }

export async function pickIdImage(): Promise<ImagePickerResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      return { ok: false, reason: 'denied' }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      aspect: [3, 2]
    })
    if (result.canceled) {
      return { ok: false, reason: 'cancelled' }
    }
    const asset = result.assets[0]
    if (!asset) {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, uri: asset.uri }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

export type DocumentResult =
  | { readonly ok: true; readonly uri: string; readonly name: string }
  | { readonly ok: false; readonly reason: 'cancelled' | 'failed' }

export async function pickRegistrationDoc(): Promise<DocumentResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false
    })
    if (result.canceled) {
      return { ok: false, reason: 'cancelled' }
    }
    const file = result.assets?.[0]
    if (!file) {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, uri: file.uri, name: file.name }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
