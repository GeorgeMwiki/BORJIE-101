import { Pressable, StyleSheet, Text } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface PrimaryButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly variant?: 'primary' | 'gold' | 'ghost'
  readonly disabled?: boolean
}

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false
}: PrimaryButtonProps) {
  const palette = palettes[variant]
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  )
}

const palettes = {
  primary: { bg: colors.forest, border: colors.forest, fg: colors.bone },
  gold: { bg: colors.gold, border: colors.gold, fg: colors.earth },
  ghost: { bg: 'transparent', border: colors.forest, fg: colors.forest }
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1
  },
  label: { ...typography.bodyStrong },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 }
})
