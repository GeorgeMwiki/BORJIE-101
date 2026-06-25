import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { localizeApiError } from '@borjie/error-catalog'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import { useTranslation } from '@/hooks/useTranslation'
import { registerUpload } from './api'
import { ALLOWED_MIMES, validateUpload, type UploadResult } from './types'

export interface DocumentUploadButtonProps {
  readonly label?: string
  readonly onUploaded?: (result: UploadResult) => void
  readonly onError?: (message: string) => void
  readonly variant?: 'paperclip' | 'button'
}

/**
 * DocumentUploadButton (buyer-mobile) — paperclip / button used by the
 * Documents tab and the chat composer. See workforce-mobile sibling for
 * the canonical contract.
 */
export function DocumentUploadButton({
  label,
  onUploaded,
  onError,
  variant = 'button',
}: DocumentUploadButtonProps) {
  const { t, lang } = useTranslation()
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
        onError?.(t('documents.upload_no_file'))
        return
      }
      const validation = validateUpload({
        fileName: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        fileSize: asset.size ?? 0,
      })
      if (!validation.ok) {
        setBusy(false)
        // Localize via the validation CODE — never surface the raw English
        // `validation.message` (under `sw` that is language mixing).
        onError?.(localizeApiError(validation.code, lang))
        return
      }
      const result = await registerUpload({
        fileName: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        fileSize: asset.size ?? 0,
      })
      onUploaded?.(result)
    } catch (cause) {
      // Never render a raw English `error.message` off the wire. Route the
      // ApiError code through the shared catalog; unknown codes fall back to
      // the active-locale generic message.
      if (__DEV__ && cause instanceof Error) {
        console.warn('[DocumentUploadButton] upload failed:', cause.message) // eslint-disable-line no-console -- reason: DEV-only mobile diagnostic per CLAUDE.md mobile-console rule
      }
      onError?.(
        localizeApiError(cause instanceof Error ? cause : undefined, lang) ||
          t('documents.upload_failed'),
      )
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'paperclip') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? t('documents.attach_document')}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={handlePress}
        style={({ pressed }) => [styles.paperclip, pressed ? styles.paperclipPressed : null]}
      >
        {busy ? (
          <ActivityIndicator color={colors.gold} />
        ) : (
          <Text style={styles.paperclipGlyph}>{'📎'}</Text>
        )}
      </Pressable>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? t('documents.upload_document')}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={handlePress}
      style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
    >
      <View style={styles.buttonInner}>
        <Text style={styles.buttonGlyph}>{'📎'}</Text>
        <Text style={styles.buttonLabel}>{label ?? t('documents.upload_document')}</Text>
        {busy ? <ActivityIndicator color={colors.bone} /> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  paperclip: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  paperclipPressed: {
    backgroundColor: colors.cream,
  },
  paperclipGlyph: {
    ...typography.heading,
    color: colors.copper,
  },
  button: {
    backgroundColor: colors.forest,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  buttonPressed: {
    backgroundColor: colors.forestSoft,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  buttonGlyph: {
    ...typography.heading,
    color: colors.gold,
  },
  buttonLabel: {
    ...typography.bodyStrong,
    color: colors.bone,
  },
})
