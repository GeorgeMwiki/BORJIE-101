import { StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinAvatarProps {
  readonly name: string
  readonly size?: number
  readonly ringed?: boolean
}

/**
 * Circular avatar with gold ring (LitFin's signature for active users
 * and personas). Renders initials in cream-on-deep-navy with an optional
 * 2px gold halo.
 */
export function LitFinAvatar({ name, size = 40, ringed = true }: LitFinAvatarProps): JSX.Element {
  const initials = pickInitials(name)
  const dims = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: ringed ? 2 : 0
  }
  return (
    <View style={[styles.wrap, dims, { borderColor: tokens.color.gold }]}>
      <Text style={[styles.text, { fontSize: Math.round(size * 0.4) }]}>{initials}</Text>
    </View>
  )
}

function pickInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'B'
  const first = parts[0]
  const last = parts.length > 1 ? parts[parts.length - 1] : null
  const a = first ? first[0] : ''
  const b = last ? last[0] : ''
  return `${a ?? ''}${b ?? ''}`.toUpperCase() || 'B'
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: tokens.color.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: {
    color: tokens.color.gold,
    fontWeight: '700',
    letterSpacing: 0.5
  }
})
