import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export interface SectionHeaderProps {
  readonly title: string
  readonly subtitle?: string
}

export function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  title: { ...typography.title, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs }
})
