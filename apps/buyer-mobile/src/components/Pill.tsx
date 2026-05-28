import { StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'gold'

export interface PillProps {
  readonly label: string
  readonly tone?: PillTone
}

/**
 * Status pill — LitFin badge family. 14% tone tint on a soft hairline
 * border, full-saturation text. Same recipe as the LitFin web badges
 * on the borrower dashboard.
 */
const toneStyles: Record<PillTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: 'rgba(255, 255, 255, 0.06)', fg: tokens.color.textSecondary, border: tokens.color.border },
  success: { bg: 'rgba(46, 189, 133, 0.16)', fg: tokens.color.success, border: 'rgba(46, 189, 133, 0.32)' },
  warning: { bg: 'rgba(255, 200, 87, 0.14)', fg: tokens.color.gold, border: tokens.color.borderGold },
  danger: { bg: 'rgba(225, 75, 75, 0.14)', fg: tokens.color.danger, border: 'rgba(225, 75, 75, 0.36)' },
  gold: { bg: 'rgba(255, 200, 87, 0.18)', fg: tokens.color.gold, border: tokens.color.borderGold }
}

export function Pill({ label, tone = 'neutral' }: PillProps) {
  const palette = toneStyles[tone]
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: tokens.space.sm + 2,
    paddingVertical: 3,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start'
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase'
  }
})
