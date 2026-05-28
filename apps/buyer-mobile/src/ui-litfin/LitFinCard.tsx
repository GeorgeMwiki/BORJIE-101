import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { tokens } from './tokens'

export type LitFinCardTone = 'raised' | 'deep' | 'gold' | 'success' | 'danger'

export interface LitFinCardProps {
  readonly children: ReactNode
  readonly tone?: LitFinCardTone
  readonly onPress?: () => void
  readonly style?: ViewStyle
  readonly testID?: string
  readonly padded?: boolean
}

/**
 * LitFin signature card — `rounded-3xl border border-white/10 bg-navy/60
 * backdrop-blur-xl shadow-card`, translated for React Native. Tones add a
 * subtle 2px top accent matching the LitFin variant family.
 */
export function LitFinCard({
  children,
  tone = 'raised',
  onPress,
  style,
  testID,
  padded = true
}: LitFinCardProps): JSX.Element {
  const palette = toneStyles[tone]
  const accent = toneAccent[tone]
  const body = (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.bg, borderColor: palette.border },
        padded && styles.cardPadded,
        accent ? { borderTopWidth: 2, borderTopColor: accent } : null,
        tokens.shadow.card,
        style
      ]}
    >
      {children}
    </View>
  )
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [pressed ? styles.pressed : null]}
      >
        {body}
      </Pressable>
    )
  }
  return (
    <View testID={testID} style={styles.wrap}>
      {body}
    </View>
  )
}

const toneStyles: Record<LitFinCardTone, { bg: string; border: string }> = {
  raised: { bg: tokens.color.bgRaised, border: tokens.color.border },
  deep: { bg: tokens.color.bgBase, border: tokens.color.border },
  gold: { bg: tokens.color.bgRaised, border: tokens.color.borderGold },
  success: { bg: tokens.color.bgRaised, border: 'rgba(46, 189, 133, 0.32)' },
  danger: { bg: tokens.color.bgRaised, border: 'rgba(225, 75, 75, 0.32)' }
}

const toneAccent: Record<LitFinCardTone, string | null> = {
  raised: null,
  deep: null,
  gold: tokens.color.gold,
  success: tokens.color.success,
  danger: tokens.color.danger
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  card: {
    borderRadius: tokens.radius.xl,
    borderWidth: 1
  },
  cardPadded: {
    padding: tokens.space.lg
  },
  pressed: { opacity: 0.94, transform: [{ scale: 0.99 }] }
})
