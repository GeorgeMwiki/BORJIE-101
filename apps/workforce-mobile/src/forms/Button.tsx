import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ViewStyle } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  loading?: boolean
  style?: ViewStyle
  testID?: string
}

const VARIANT_STYLES: Record<ButtonVariant, { background: string; text: string; border?: string }> = {
  primary: { background: colors.gold, text: colors.earth900 },
  secondary: { background: colors.earth700, text: colors.textInverse },
  danger: { background: colors.danger, text: colors.textInverse },
  ghost: { background: 'transparent', text: colors.earth700, border: colors.border }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  testID
}: ButtonProps): JSX.Element {
  const palette = VARIANT_STYLES[variant]
  const isInactive = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      accessibilityLabel={label}
      onPress={isInactive ? undefined : onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.background,
          borderColor: palette.border ?? palette.background,
          opacity: isInactive ? 0.5 : pressed ? 0.85 : 1
        },
        style
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator color={palette.text} />
        ) : (
          <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    justifyContent: 'center'
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  label: {
    fontSize: fontSize.lead,
    fontWeight: '700'
  }
})
