import { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface CardProps {
  readonly children: ReactNode
  readonly onPress?: () => void
}

/**
 * Buyer card — LitFin signature: rounded 24, hairline white-on-navy
 * border, deep raised navy ground, soft drop shadow. Matches the
 * borrower portal "rounded-3xl bg-navy/60" recipe.
 */
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
    backgroundColor: tokens.color.bgRaised,
    borderRadius: tokens.radius.xl,
    padding: tokens.space.lg,
    marginBottom: tokens.space.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.card
  },
  pressed: { opacity: 0.94, transform: [{ scale: 0.99 }] }
})
