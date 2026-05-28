import { StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface SectionHeaderProps {
  readonly title: string
  readonly subtitle?: string
}

/**
 * LitFin section header — cream display title + muted subtitle.
 * Matches the LitFin web borrower dashboard subsection rhythm.
 */
export function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: tokens.space.lg },
  title: { ...tokens.type.h2, color: tokens.color.textPrimary },
  subtitle: {
    ...tokens.type.bodySm,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs
  }
})
