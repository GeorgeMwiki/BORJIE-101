import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export interface EmptyStateProps {
  readonly message: string
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.xl, alignItems: 'center' },
  text: { ...typography.body, color: colors.inkMuted, textAlign: 'center' }
})
