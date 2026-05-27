/**
 * FailureDot — top-right marker on a user bubble whose mutation failed.
 *
 * Per R7 §6.1 we never use a banner for transient send errors — they
 * block the conversation and read as catastrophic. Instead the failed
 * user bubble carries an 8 px red dot whose tap triggers retry. Tap
 * target is padded to 44 px to stay above the WCAG 2.2 minimum.
 */
import { Pressable, StyleSheet, View } from 'react-native'
import { colors } from '../theme/colors'

export interface FailureDotProps {
  readonly onPress: () => void
  readonly accessibilityLabel: string
}

export function FailureDot({
  onPress,
  accessibilityLabel
}: FailureDotProps): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.target}
      hitSlop={12}
      testID="home-chat-failure-dot"
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
    borderColor: colors.surface
  }
})
