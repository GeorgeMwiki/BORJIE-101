import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useToast } from './Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

// PDF rendering relies on react-native-pdf which needs an EAS dev build.
// Until that ships we render a placeholder + open the asset in the OS
// browser via Linking. Swap the body for <Pdf source={{ uri }} /> once
// the native module is installed.
export interface PdfViewerProps {
  readonly url: string
  readonly title?: string
}

export function PdfViewer({ url, title = 'PDF' }: PdfViewerProps) {
  const { t } = useTranslation()
  const toast = useToast()

  async function handleOpen(): Promise<void> {
    try {
      const supported = await Linking.canOpenURL(url)
      if (!supported) {
        toast.show(t('documents.pdf_open_failed'), 'error')
        return
      }
      await Linking.openURL(url)
    } catch {
      toast.show(t('documents.pdf_open_failed'), 'error')
    }
  }

  return (
    <View>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderLabel}>{title}</Text>
        <Text style={styles.placeholderHint} numberOfLines={1}>
          {url}
        </Text>
      </View>
      <Pressable onPress={handleOpen} style={styles.openButton}>
        <Text style={styles.openLabel}>{t('documents.view_pdf')}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  placeholder: {
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md
  },
  placeholderLabel: { ...typography.display, color: colors.earth },
  placeholderHint: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs, paddingHorizontal: spacing.md },
  openButton: {
    borderWidth: 1,
    borderColor: colors.forest,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center'
  },
  openLabel: { ...typography.bodyStrong, color: colors.forest }
})
