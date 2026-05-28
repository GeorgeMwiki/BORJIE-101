import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export type LitFinToastTone = 'success' | 'warning' | 'critical' | 'info'

export interface LitFinToastProps {
  readonly tone: LitFinToastTone
  readonly message: string
  readonly visible: boolean
  readonly testID?: string
}

/**
 * LitFin toast — pill with left dot + body 14/600. Tones map to
 * success / warning / critical / info. Fades in over 200ms,
 * stays until parent flips visible to false.
 */
export function LitFinToast({ tone, message, visible, testID }: LitFinToastProps): JSX.Element | null {
  const opacity = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true
    }).start()
  }, [opacity, visible])
  if (!visible) {
    return null
  }
  const palette = toneStyles[tone]
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[styles.wrap, { opacity }]}
    >
      <View style={[styles.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
        <View style={[styles.dot, { backgroundColor: palette.dot }]} />
        <Text style={[styles.label, { color: palette.fg }]}>{message}</Text>
      </View>
    </Animated.View>
  )
}

const toneStyles: Record<LitFinToastTone, { bg: string; border: string; fg: string; dot: string }> = {
  success: {
    bg: 'rgba(46, 189, 133, 0.16)',
    border: 'rgba(46, 189, 133, 0.40)',
    fg: tokens.color.textPrimary,
    dot: tokens.color.success
  },
  warning: {
    bg: 'rgba(255, 200, 87, 0.16)',
    border: 'rgba(255, 200, 87, 0.40)',
    fg: tokens.color.textPrimary,
    dot: tokens.color.gold
  },
  critical: {
    bg: 'rgba(225, 75, 75, 0.16)',
    border: 'rgba(225, 75, 75, 0.40)',
    fg: tokens.color.textPrimary,
    dot: tokens.color.danger
  },
  info: {
    bg: 'rgba(255, 255, 255, 0.08)',
    border: 'rgba(255, 255, 255, 0.16)',
    fg: tokens.color.textPrimary,
    dot: tokens.color.textSecondary
  }
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center'
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    gap: tokens.space.sm,
    maxWidth: '90%'
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  label: {
    ...tokens.type.bodySmStrong
  }
})
