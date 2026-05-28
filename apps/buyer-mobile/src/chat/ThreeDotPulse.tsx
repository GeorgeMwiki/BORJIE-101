/**
 * ThreeDotPulse — buyer-mobile typing indicator.
 *
 * Replaces the permanent `ActivityIndicator` flagged in R7 §6.2 as an
 * anti-pattern (a spinner that appears on press communicates "we have
 * no idea when this ends"). Three dots pulse on a 600 ms cycle.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { colors } from '@/theme/colors'

export interface ThreeDotPulseProps {
  readonly active?: boolean
}

const PULSE_DURATION_MS = 600
const DOT_STAGGER_MS = 150

export function ThreeDotPulse({ active = true }: ThreeDotPulseProps) {
  const dot0 = useRef(new Animated.Value(0.3)).current
  const dot1 = useRef(new Animated.Value(0.3)).current
  const dot2 = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    if (!active) {
      return
    }
    const startDot = (
      value: Animated.Value,
      delay: number
    ): Animated.CompositeAnimation =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: PULSE_DURATION_MS / 2,
            useNativeDriver: true
          }),
          Animated.timing(value, {
            toValue: 0.3,
            duration: PULSE_DURATION_MS / 2,
            useNativeDriver: true
          })
        ])
      )
    const loops = [
      startDot(dot0, 0),
      startDot(dot1, DOT_STAGGER_MS),
      startDot(dot2, DOT_STAGGER_MS * 2)
    ]
    for (const loop of loops) {
      loop.start()
    }
    return () => {
      for (const loop of loops) {
        loop.stop()
      }
    }
  }, [active, dot0, dot1, dot2])

  const dots = useMemo(() => [dot0, dot1, dot2], [dot0, dot1, dot2])

  return (
    <View testID="buyer-chat-three-dot-pulse" style={styles.wrap}>
      {dots.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            { opacity: value, transform: [{ scale: value }] }
          ]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.gold
  }
})
