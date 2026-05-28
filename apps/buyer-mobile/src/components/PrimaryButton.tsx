import { Pressable, StyleSheet, Text } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface PrimaryButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly variant?: 'primary' | 'gold' | 'ghost'
  readonly disabled?: boolean
}

/**
 * Buyer primary button — LitFin pill family.
 *  - primary | gold : warm gold fill, navy text (LitFin hero CTA)
 *  - ghost          : transparent, cream text, gold hairline border
 */
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
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        variant === 'primary' || variant === 'gold' ? tokens.shadow.glow : null,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  )
}

const palettes = {
  primary: { bg: tokens.color.gold, border: tokens.color.goldDeep, fg: tokens.color.userBubbleText },
  gold: { bg: tokens.color.gold, border: tokens.color.goldDeep, fg: tokens.color.userBubbleText },
  ghost: { bg: 'transparent', border: tokens.color.borderGold, fg: tokens.color.gold }
} as const

const styles = StyleSheet.create({
  button: {
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.xl,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 48
  },
  label: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 }
})
