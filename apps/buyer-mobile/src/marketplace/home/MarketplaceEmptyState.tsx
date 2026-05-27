import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface MarketplaceEmptyStateProps {
  readonly message: string
  readonly tone?: 'info' | 'warning' | 'error'
}

const toneStyles = {
  info: { bg: colors.cream, fg: colors.inkSoft },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  error: { bg: colors.dangerSoft, fg: colors.danger }
} as const

export function MarketplaceEmptyState({
  message,
  tone = 'info'
}: MarketplaceEmptyStateProps) {
  const palette = toneStyles[tone]
  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <Text style={[styles.text, { color: palette.fg }]}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md
  },
  text: { ...typography.caption, textAlign: 'left' }
})
