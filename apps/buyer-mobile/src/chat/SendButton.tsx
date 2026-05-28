/**
 * SendButton — buyer-mobile, Doherty-compliant.
 *
 * Press-down scales to 0.95 in 80 ms then springs through 1.05 → 1.0
 * (R7 §4.2). A 10 ms Vibration pulse fires on press as a tactile ack
 * within Doherty's 400 ms bound. We use the core RN `Vibration` API
 * to avoid pulling in expo-haptics (only `react-native-sse` is being
 * added this wave per the change scope).
 */
import { useCallback, useRef } from 'react'
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View
} from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface SendButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly accessibilityLabel: string
  readonly enabled: boolean
}

export function SendButton({
  label,
  onPress,
  accessibilityLabel,
  enabled
}: SendButtonProps) {
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
      // best-effort
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
        testID="buyer-chat-send"
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
    paddingVertical: spacing.md,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.goldSoft
  },
  pressed: {
    opacity: 0.88
  },
  disabled: {
    opacity: 0.45
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  label: {
    ...typography.bodyStrong,
    color: colors.ink,
    fontWeight: '700'
  }
})
