import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface PrimaryButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly variant?: 'primary' | 'gold' | 'ghost'
  readonly disabled?: boolean
  /**
   * When true the button shows an inline spinner and is non-interactive.
   * Used by debounced submit flows (RFB create, login) to prevent double-tap.
   */
  readonly busy?: boolean
  readonly testID?: string
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
  disabled = false,
  busy = false,
  testID
}: PrimaryButtonProps) {
  const palette = palettes[variant]
  const isBlocked = disabled || busy
  return (
    <Pressable
      onPress={onPress}
      disabled={isBlocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isBlocked, busy }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        variant === 'primary' || variant === 'gold' ? tokens.shadow.glow : null,
        pressed && !isBlocked && styles.pressed,
        isBlocked && styles.disabled
      ]}
    >
      <View style={styles.inner}>
        {busy ? (
          <ActivityIndicator color={palette.fg} style={styles.spinner} />
        ) : null}
        <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
      </View>
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
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  spinner: {
    marginRight: tokens.space.sm
  },
  label: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 }
})
