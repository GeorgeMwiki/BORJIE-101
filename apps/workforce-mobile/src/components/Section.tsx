import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import type { ReactNode } from 'react'
import { tokens } from '../ui-litfin'

export interface SectionProps {
  title: string
  hint?: string
  style?: ViewStyle
  children: ReactNode
}

/**
 * LitFin-styled section — eyebrow-cap title in cream-on-navy with
 * a soft gold ruling under the heading, then the body below. Mirrors
 * the LitFin web `SectionHeader` rhythm.
 */
export function Section({ title, hint, style, children }: SectionProps): JSX.Element {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.body}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: tokens.space.xl
  },
  title: {
    ...tokens.type.h3,
    color: tokens.color.textPrimary
  },
  hint: {
    ...tokens.type.bodySm,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs
  },
  body: {
    marginTop: tokens.space.md
  }
})
