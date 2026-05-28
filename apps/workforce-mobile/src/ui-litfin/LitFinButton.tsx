import { Pressable, StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export type LitFinButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type LitFinButtonSize = 'sm' | 'md' | 'lg'

export interface LitFinButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly variant?: LitFinButtonVariant
  readonly size?: LitFinButtonSize
  readonly disabled?: boolean
  readonly leadingIcon?: string
  readonly trailingIcon?: string
  readonly accessibilityLabel?: string
  readonly testID?: string
  readonly fullWidth?: boolean
}

/**
 * LitFin button primitive. Pill-shaped, three variants:
 *  - primary  : warm gold fill + navy text (LitFin hero CTA)
 *  - secondary: navy fill + gold outline + gold text
 *  - ghost    : transparent + cream text + 1px navy hairline
 *  - danger   : warm-red fill + cream text
 */
export function LitFinButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  leadingIcon,
  trailingIcon,
  accessibilityLabel,
  testID,
  fullWidth = false
}: LitFinButtonProps): JSX.Element {
  const palette = variantStyles[variant]
  const dims = sizeStyles[size]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          paddingHorizontal: dims.padX,
          paddingVertical: dims.padY,
          minHeight: dims.minH
        },
        fullWidth ? styles.fullWidth : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        variant === 'primary' ? tokens.shadow.glow : null
      ]}
    >
      <View style={styles.row}>
        {leadingIcon ? <Text style={[styles.icon, { color: palette.fg }]}>{leadingIcon}</Text> : null}
        <Text style={[styles.label, { color: palette.fg, fontSize: dims.font }]}>{label}</Text>
        {trailingIcon ? <Text style={[styles.icon, { color: palette.fg }]}>{trailingIcon}</Text> : null}
      </View>
    </Pressable>
  )
}

const variantStyles: Record<
  LitFinButtonVariant,
  { bg: string; border: string; fg: string }
> = {
  primary: { bg: tokens.color.gold, border: tokens.color.goldDeep, fg: tokens.color.userBubbleText },
  secondary: { bg: tokens.color.bgRaised, border: tokens.color.borderGold, fg: tokens.color.gold },
  ghost: { bg: 'transparent', border: tokens.color.border, fg: tokens.color.textPrimary },
  danger: { bg: tokens.color.danger, border: tokens.color.danger, fg: tokens.color.textPrimary }
}

const sizeStyles: Record<LitFinButtonSize, { padX: number; padY: number; minH: number; font: number }> = {
  sm: { padX: tokens.space.md, padY: tokens.space.sm, minH: 36, font: 14 },
  md: { padX: tokens.space.lg, padY: tokens.space.md, minH: 44, font: 15 },
  lg: { padX: tokens.space.xl, padY: tokens.space.md + 2, minH: 52, font: 16 }
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  label: { fontWeight: '700', letterSpacing: -0.2 },
  icon: { fontSize: 16, fontWeight: '700' }
})
