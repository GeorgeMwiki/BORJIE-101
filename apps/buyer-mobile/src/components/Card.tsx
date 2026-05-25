import { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing } from '@/theme/spacing'

export interface CardProps {
  readonly children: ReactNode
  readonly onPress?: () => void
}

export function Card({ children, onPress }: CardProps) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        {children}
      </Pressable>
    )
  }
  return <View style={styles.card}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.line
  },
  pressed: { opacity: 0.85 }
})
