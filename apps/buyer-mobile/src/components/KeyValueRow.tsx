import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export interface KeyValueRowProps {
  readonly label: string
  readonly value: string
}

export function KeyValueRow({ label, value }: KeyValueRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  label: { ...typography.caption, color: colors.inkMuted },
  value: { ...typography.bodyStrong, color: colors.ink, textAlign: 'right', flexShrink: 1, marginLeft: spacing.lg }
})
