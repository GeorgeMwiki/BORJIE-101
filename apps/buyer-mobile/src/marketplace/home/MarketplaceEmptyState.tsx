import { StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface MarketplaceEmptyStateProps {
  readonly message: string
  readonly tone?: 'info' | 'warning' | 'error'
}

const toneStyles = {
  info: {
    bg: 'rgba(255, 255, 255, 0.06)',
    fg: tokens.color.textSecondary,
    border: tokens.color.border
  },
  warning: {
    bg: 'rgba(255, 200, 87, 0.14)',
    fg: tokens.color.gold,
    border: tokens.color.borderGold
  },
  error: {
    bg: 'rgba(225, 75, 75, 0.14)',
    fg: tokens.color.danger,
    border: 'rgba(225, 75, 75, 0.36)'
  }
} as const

export function MarketplaceEmptyState({
  message,
  tone = 'info'
}: MarketplaceEmptyStateProps) {
  const palette = toneStyles[tone]
  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.text, { color: palette.fg }]}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    marginBottom: tokens.space.md
  },
  text: { ...tokens.type.bodySm, fontWeight: '600' }
})
