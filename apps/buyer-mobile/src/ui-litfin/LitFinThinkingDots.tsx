import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { useTranslation } from '@/hooks/useTranslation'
import { LitFinAvatar } from './LitFinAvatar'
import { tokens } from './tokens'

export interface LitFinThinkingDotsProps {
  /**
   * Wrap the dots in the canonical AI typing row — a gold-top bubble with
   * the persona mark to its left, matching the web `TypingDots`
   * (packages/chat-ui/src/litfin-primitives.tsx) and the Flutter
   * `_ThinkingDots`. Defaults to the bare three-dot pulse so existing
   * inline call sites keep their compact footprint.
   */
  readonly withBubble?: boolean
  readonly avatarName?: string
}

/**
 * LitFin three-dot thinking pulse — gold dots, proportional gaps,
 * staggered opacity cycle matching the web ChatPanel waveform. With
 * `withBubble`, it renders the full assistant typing row (avatar + AI
 * bubble) so a pending turn reads identically to a settled AI reply.
 */
export function LitFinThinkingDots({
  withBubble = false,
  avatarName
}: LitFinThinkingDotsProps = {}): JSX.Element {
  const { t } = useTranslation()
  const a = useRef(new Animated.Value(0.35)).current
  const b = useRef(new Animated.Value(0.35)).current
  const c = useRef(new Animated.Value(0.35)).current

  useEffect(() => {
    function startPulse(value: Animated.Value, delay: number): Animated.CompositeAnimation {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 360,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true
          }),
          Animated.timing(value, {
            toValue: 0.35,
            duration: 360,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true
          })
        ])
      )
    }
    const anims = [startPulse(a, 0), startPulse(b, 140), startPulse(c, 280)]
    anims.forEach((anim) => anim.start())
    return () => anims.forEach((anim) => anim.stop())
  }, [a, b, c])

  const dots = (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityLabel={t('chat.assistant_thinking')}
    >
      <Animated.View style={[styles.dot, { opacity: a }]} />
      <Animated.View style={[styles.dot, { opacity: b }]} />
      <Animated.View style={[styles.dot, { opacity: c }]} />
    </View>
  )

  if (!withBubble) {
    return dots
  }

  return (
    <View style={styles.typingRow}>
      <View style={styles.avatarSlot}>
        <LitFinAvatar name={avatarName ?? 'Mr. Mwikila'} size={32} />
      </View>
      <View style={styles.bubble}>
        <View style={styles.accent} />
        {dots}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.color.gold
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: tokens.space.sm,
    marginVertical: tokens.space.xs
  },
  avatarSlot: {
    marginBottom: 2
  },
  bubble: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.lg,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: tokens.color.aiBubbleBorder,
    backgroundColor: tokens.color.aiBubbleBg,
    overflow: 'hidden'
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: tokens.color.aiBubbleTopAccent
  }
})
