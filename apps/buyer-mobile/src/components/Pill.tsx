import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'gold'

export interface PillProps {
  readonly label: string
  readonly tone?: PillTone
}

const toneStyles: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.sand, fg: colors.inkSoft },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  gold: { bg: colors.goldSoft, fg: colors.earth }
}

export function Pill({ label, tone = 'neutral' }: PillProps) {
  const palette = toneStyles[tone]
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: 'flex-start'
  },
  label: { ...typography.micro, textTransform: 'uppercase' }
})
