import { StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface EmptyStateProps {
  readonly message: string
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.plate}>
        <Text style={styles.glyph}>·</Text>
      </View>
      <Text style={styles.text}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: tokens.space.xxl,
    paddingHorizontal: tokens.space.lg,
    alignItems: 'center',
    backgroundColor: tokens.color.bgRaised,
    borderRadius: tokens.radius.xl,
    borderWidth: 1,
    borderColor: tokens.color.border
  },
  plate: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tokens.color.bgBase,
    borderWidth: 1,
    borderColor: tokens.color.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.space.md
  },
  glyph: { fontSize: 24, color: tokens.color.gold, fontWeight: '800' },
  text: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    textAlign: 'center'
  }
})
