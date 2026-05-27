import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { formatRecomputeMinutes } from './format'
import type { OwnerBrief } from './types'

export interface AiDailyBriefProps {
  readonly brief: OwnerBrief
  readonly lang: 'sw' | 'en'
}

/**
 * Slot 1 — AI Daily Brief. One paragraph in the active language, with a
 * recompute timestamp footer. Spec §F: "AI summary at the very top".
 * Every claim cites at least one evidence_id (rendered as superscripted
 * count to keep the screen compact); tapping evidence opens the source
 * via the existing chat-corpus-evidence flow (handled in later screens).
 */
export function AiDailyBrief({ brief, lang }: AiDailyBriefProps): JSX.Element {
  const text = lang === 'sw' ? brief.swText : brief.enText
  const minutesAgo = formatRecomputeMinutes(brief.generatedAtIso)
  const recomputeLabel = lang === 'sw'
    ? `Imeandaliwa dakika ${Number.isFinite(minutesAgo) ? minutesAgo : '—'} zilizopita`
    : `Computed ${Number.isFinite(minutesAgo) ? minutesAgo : '—'} min ago`
  const evidenceCount = brief.evidenceIds.length
  const evidenceLabel = lang === 'sw'
    ? `Ushahidi ${evidenceCount}`
    : `Evidence ${evidenceCount}`

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={text}
      testID="owner-home-ai-brief"
      style={styles.wrap}
    >
      <Text style={styles.header}>{lang === 'sw' ? 'Brief ya leo' : 'Daily brief'}</Text>
      <Text style={styles.body}>{text}</Text>
      <View style={styles.footer}>
        <Text style={styles.meta}>{recomputeLabel}</Text>
        <Text style={styles.meta}>{evidenceLabel}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold
  },
  header: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  body: {
    color: colors.text,
    fontSize: fontSize.lead,
    marginTop: spacing.sm,
    lineHeight: fontSize.lead * 1.4
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '600'
  }
})
