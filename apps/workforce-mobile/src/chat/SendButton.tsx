/**
 * SendButton — Doherty-compliant send affordance.
 *
 * Press-down scales to 0.95 in 80 ms, releases to 1.05 then settles to
 * 1.0 (Swiggy / R7 ms§4.2). A light Vibration pulse on press registers
 * within 100 ms even on cheap Android. We use the RN core
 * `Vibration` API rather than expo-haptics so the component carries no
 * extra dependency (only `react-native-sse` is being added this wave).
 */
import { useCallback, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, Vibration, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface SendButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly accessibilityLabel: string
  /** When false the button reads as a placeholder (empty draft). */
  readonly enabled: boolean
}

export function SendButton({
  label,
  onPress,
  accessibilityLabel,
  enabled
}: SendButtonProps): JSX.Element {
  const scale = useRef(new Animated.Value(1)).current

  const playPressIn = useCallback(() => {
    Animated.timing(scale, {
      toValue: 0.95,
      duration: 80,
      useNativeDriver: true
    }).start()
  }, [scale])

  const playPressOut = useCallback(() => {
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 1.05,
        damping: 8,
        stiffness: 200,
        useNativeDriver: true
      }),
      Animated.spring(scale, {
        toValue: 1.0,
        damping: 12,
        stiffness: 200,
        useNativeDriver: true
      })
    ]).start()
  }, [scale])

  const handlePress = useCallback(() => {
    if (!enabled) {
      return
    }
    try {
      Vibration.vibrate(10)
    } catch {
      // best-effort — vibration is unavailable on web / iOS simulators
    }
    onPress()
  }, [enabled, onPress])

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !enabled }}
        onPress={handlePress}
        onPressIn={playPressIn}
        onPressOut={playPressOut}
        style={({ pressed }) => [
          styles.button,
          pressed ? styles.pressed : null,
          !enabled ? styles.disabled : null
        ]}
        testID="home-chat-send"
      >
        <View style={styles.inner}>
          <Text style={styles.label}>{label}</Text>
        </View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center'
  },
  pressed: {
    backgroundColor: colors.goldDark
  },
  disabled: {
    opacity: 0.45
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  label: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  }
})
