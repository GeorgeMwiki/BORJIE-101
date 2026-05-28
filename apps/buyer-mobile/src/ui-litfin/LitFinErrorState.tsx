import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinErrorStateProps {
  readonly icon?: string
  readonly title: string
  readonly description?: string
  readonly primaryCta?: { label: string; onPress: () => void }
  readonly secondaryCta?: { label: string; onPress: () => void }
  readonly tone?: 'warning' | 'critical' | 'info'
  readonly testID?: string
  readonly extras?: ReactNode
}

/**
 * LitFin error / 404 / offline state — centred cluster with plate
 * icon, title, body, and CTA pair. Tone tints the plate accent.
 */
export function LitFinErrorState({
  icon = '!',
  title,
  description,
  primaryCta,
  secondaryCta,
  tone = 'critical',
  testID,
  extras
}: LitFinErrorStateProps): JSX.Element {
  const accent = toneAccent[tone]
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={[styles.plate, { borderColor: accent }]}>
        <Text style={[styles.icon, { color: accent }]}>{icon}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.body}>{description}</Text> : null}
      {extras ? <View style={styles.extras}>{extras}</View> : null}
      <View style={styles.actions}>
        {primaryCta ? (
          <Pressable
            accessibilityRole="button"
            onPress={primaryCta.onPress}
            style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
          >
            <Text style={styles.primaryLabel}>{primaryCta.label}</Text>
          </Pressable>
        ) : null}
        {secondaryCta ? (
          <Pressable
            accessibilityRole="button"
            onPress={secondaryCta.onPress}
            style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
          >
            <Text style={styles.secondaryLabel}>{secondaryCta.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const toneAccent: Record<NonNullable<LitFinErrorStateProps['tone']>, string> = {
  warning: tokens.color.gold,
  critical: tokens.color.danger,
  info: tokens.color.textSecondary
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.xxl,
    backgroundColor: tokens.color.bgBase
  },
  plate: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    backgroundColor: tokens.color.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  icon: {
    fontSize: 44,
    fontWeight: '700'
  },
  title: {
    ...tokens.type.h2,
    color: tokens.color.textPrimary,
    marginTop: tokens.space.lg,
    textAlign: 'center'
  },
  body: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.sm,
    textAlign: 'center',
    maxWidth: 320
  },
  extras: {
    marginTop: tokens.space.lg,
    width: '100%',
    alignItems: 'center'
  },
  actions: {
    marginTop: tokens.space.xl,
    flexDirection: 'row',
    gap: tokens.space.md,
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  primary: {
    backgroundColor: tokens.color.gold,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.md + 2,
    minHeight: 52,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryLabel: {
    ...tokens.type.bodyStrong,
    color: tokens.color.userBubbleText
  },
  secondary: {
    borderWidth: 1,
    borderColor: tokens.color.borderGold,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.md + 2,
    minHeight: 52,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center'
  },
  secondaryLabel: {
    ...tokens.type.bodyStrong,
    color: tokens.color.gold
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }]
  }
})
