import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface FingerprintPlaceholderProps {
  label: string
  onSign?: () => void
}

/**
 * Visual stand-in for the biometric sign-off control. Real biometric flow
 * goes through expo-local-authentication in a later native phase.
 */
export function FingerprintPlaceholder({ label, onSign }: FingerprintPlaceholderProps): JSX.Element {
  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onSign}
        style={({ pressed }) => [styles.pad, pressed ? styles.padPressed : null]}
      >
        <View style={styles.ring}>
          <View style={styles.innerRing} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingVertical: spacing.md
  },
  pad: {
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.earth100
  },
  padPressed: {
    backgroundColor: colors.earth300
  },
  ring: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.earth700,
    alignItems: 'center',
    justifyContent: 'center'
  },
  innerRing: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.earth500
  },
  label: {
    marginTop: spacing.sm,
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600'
  }
})
