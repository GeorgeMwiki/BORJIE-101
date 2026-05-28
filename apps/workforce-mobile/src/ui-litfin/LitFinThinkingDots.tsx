import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { tokens } from './tokens'

/**
 * LitFin three-dot thinking pulse — gold dots, proportional gaps,
 * staggered opacity cycle matching the web ChatPanel waveform.
 */
export function LitFinThinkingDots(): JSX.Element {
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

  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel="thinking">
      <Animated.View style={[styles.dot, { opacity: a }]} />
      <Animated.View style={[styles.dot, { opacity: b }]} />
      <Animated.View style={[styles.dot, { opacity: c }]} />
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
  }
})
