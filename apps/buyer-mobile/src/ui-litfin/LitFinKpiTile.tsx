import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export type LitFinKpiTone = 'gold' | 'success' | 'warn' | 'danger' | 'neutral'

export interface LitFinKpiTileProps {
  readonly eyebrow: string
  readonly value: string
  readonly delta?: string
  readonly tone?: LitFinKpiTone
  readonly meta?: string
  readonly onPress?: () => void
  readonly icon?: ReactNode
  readonly testID?: string
}

/**
 * LitFin KPI tile — the 4-up metric block at the top of the borrower
 * dashboard. Eyebrow + big value + delta + meta. Tone changes the
 * 2px top accent + delta colour, never the body fill.
 */
export function LitFinKpiTile({
  eyebrow,
  value,
  delta,
  tone = 'gold',
  meta,
  onPress,
  icon,
  testID
}: LitFinKpiTileProps): JSX.Element {
  const accent = toneAccent(tone)
  const body = (
    <View
      style={[
        styles.card,
        { borderTopColor: accent }
      ]}
      testID={testID}
    >
      <View style={styles.headRow}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      </View>
      <Text style={styles.value}>{value}</Text>
      {delta ? (
        <Text style={[styles.delta, { color: accent }]}>{delta}</Text>
      ) : null}
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  )
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed ? styles.pressed : null, styles.flex]}>
        {body}
      </Pressable>
    )
  }
  return <View style={styles.flex}>{body}</View>
}

function toneAccent(tone: LitFinKpiTone): string {
  if (tone === 'success') return tokens.color.success
  if (tone === 'warn') return tokens.color.warn
  if (tone === 'danger') return tokens.color.danger
  if (tone === 'neutral') return tokens.color.borderStrong
  return tokens.color.gold
}

const styles = StyleSheet.create({
  flex: { flexBasis: '48%', flexGrow: 1 },
  card: {
    backgroundColor: tokens.color.bgRaised,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderTopWidth: 2,
    padding: tokens.space.lg,
    minHeight: 116
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  eyebrow: {
    ...tokens.type.eyebrow,
    color: tokens.color.textMuted
  },
  value: {
    ...tokens.type.h1,
    color: tokens.color.textPrimary,
    marginTop: tokens.space.sm
  },
  delta: {
    ...tokens.type.bodySmStrong,
    marginTop: tokens.space.xs
  },
  meta: {
    ...tokens.type.micro,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 200, 87, 0.12)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  pressed: { opacity: 0.92 }
})
