import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, spacing } from '../theme/spacing'
import type { ReactNode } from 'react'

export interface SectionProps {
  title: string
  hint?: string
  style?: ViewStyle
  children: ReactNode
}

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
    marginBottom: spacing.xl
  },
  title: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  body: {
    marginTop: spacing.md
  }
})
