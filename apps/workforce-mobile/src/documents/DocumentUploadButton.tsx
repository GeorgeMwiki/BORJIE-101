import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { registerUpload } from './api'
import { ALLOWED_MIMES, validateUpload, type UploadResult } from './types'

export interface DocumentUploadButtonProps {
  /** Surface label override (defaults to Swahili-first paperclip glyph). */
  readonly label?: string
  /** Called when a document is successfully registered. The chat surface
   *  uses this to inject a "Nimepakia <filename>..." message. */
  readonly onUploaded?: (result: UploadResult) => void
  /** Called on validation or network error. UI shows a fallback toast if
   *  not overridden. */
  readonly onError?: (message: string) => void
  /** Compact paperclip-style variant; default is a labelled button. */
  readonly variant?: 'paperclip' | 'button'
}

/**
 * DocumentUploadButton — shared paperclip / button used by:
 *   - The chat composer (paperclip variant, composed by CH-* agents).
 *   - The Documents tab (button variant, drives the "upload" CTA).
 *
 * Behaviour:
 *   1) Calls expo-document-picker with the allowed mime list.
 *   2) Validates the picked file's size + mime defensively.
 *   3) POSTs to /api/v1/mining/document-intelligence/upload.
 *   4) Fires onUploaded with the server's UploadResult.
 *
 * The component is pure UI — no global state, no react-query. Caller
 * threads the picker result into the surface's preferred state hook.
 */
export function DocumentUploadButton({
  label,
  onUploaded,
  onError,
  variant = 'button',
}: DocumentUploadButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false)

  async function handlePress(): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_MIMES as string[],
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (picked.canceled) {
        setBusy(false)
        return
      }
      const asset = picked.assets[0]
      if (!asset) {
        setBusy(false)
        onError?.('Hakuna faili iliyochaguliwa.')
        return
      }
      const validation = validateUpload({
        fileName: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        fileSize: asset.size ?? 0,
      })
      if (!validation.ok) {
        setBusy(false)
        onError?.(validation.message)
        return
      }
      const result = await registerUpload({
        fileName: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        fileSize: asset.size ?? 0,
      })
      onUploaded?.(result)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Imeshindikana kupakia faili.'
      onError?.(message)
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'paperclip') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? 'Pakia hati'}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={handlePress}
        style={({ pressed }) => [styles.paperclip, pressed ? styles.paperclipPressed : null]}
      >
        {busy ? (
          <ActivityIndicator color={colors.goldDark} />
        ) : (
          <Text style={styles.paperclipGlyph} accessibilityElementsHidden>
            {'📎'}
          </Text>
        )}
      </Pressable>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? 'Pakia hati mpya'}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={handlePress}
      style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
    >
      <View style={styles.buttonInner}>
        <Text style={styles.buttonGlyph}>{'📎'}</Text>
        <Text style={styles.buttonLabel}>{label ?? 'Pakia hati'}</Text>
        {busy ? <ActivityIndicator color={colors.surface} /> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  paperclip: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  paperclipPressed: {
    backgroundColor: colors.earth100,
  },
  paperclipGlyph: {
    fontSize: fontSize.h3,
    color: colors.goldDark,
  },
  button: {
    backgroundColor: colors.earth700,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  buttonPressed: {
    backgroundColor: colors.earth500,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  buttonGlyph: {
    fontSize: fontSize.h3,
    color: colors.gold,
  },
  buttonLabel: {
    color: colors.surface,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
})
