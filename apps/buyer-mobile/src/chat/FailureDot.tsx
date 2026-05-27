/**
 * FailureDot — buyer-mobile equivalent of the workforce-mobile dot.
 *
 * Per R7 §6.1 we never use a banner for a transient send failure. The
 * failed user bubble carries a 12 px red dot whose tap re-fires the
 * mutation with the same payload. Hit-slop padding keeps the tap
 * target at the WCAG 2.2 44 pt minimum.
 */
import { Pressable, StyleSheet, View } from 'react-native'
import { colors } from '@/theme/colors'

export interface FailureDotProps {
  readonly onPress: () => void
  readonly accessibilityLabel: string
}

export function FailureDot({
  onPress,
  accessibilityLabel
}: FailureDotProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.target}
      hitSlop={12}
      testID="buyer-chat-failure-dot"
    >
      <View style={styles.dot} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  target: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'flex-start'
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.bone
  }
})
