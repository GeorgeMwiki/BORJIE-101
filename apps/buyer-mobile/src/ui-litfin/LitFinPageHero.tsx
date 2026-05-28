import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinPageHeroProps {
  readonly eyebrow?: string
  readonly title: string
  readonly subtitle?: string
  readonly actions?: ReactNode
  readonly testID?: string
}

/**
 * LitFin hero block — the eyebrow + display title + subtitle stack
 * the borrower dashboard opens with. Used on every primary mobile
 * screen to anchor the experience.
 */
export function LitFinPageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  testID
}: LitFinPageHeroProps): JSX.Element {
  return (
    <View testID={testID} style={styles.wrap}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.xl
  },
  eyebrow: {
    ...tokens.type.eyebrow,
    color: tokens.color.gold,
    marginBottom: tokens.space.sm
  },
  title: {
    ...tokens.type.h1,
    color: tokens.color.textPrimary
  },
  subtitle: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.sm,
    maxWidth: 520
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
    marginTop: tokens.space.lg
  }
})
