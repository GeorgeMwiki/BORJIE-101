import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { RoleClassification } from './intelligence'

export interface RoleGuessCardCopy {
  guessHeader: string
  confidenceLabel: string
  matchedHeader: string
  overrideCta: string
  lowConfidenceHint: string
}

export interface RoleGuessCardProps {
  classification: RoleClassification
  roleLabel: string
  copy: RoleGuessCardCopy
  lowConfidence: boolean
  onOverride: () => void
}

export function RoleGuessCard({
  classification,
  roleLabel,
  copy,
  lowConfidence,
  onOverride
}: RoleGuessCardProps): JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.header}>{copy.guessHeader}</Text>
      <Text style={styles.role}>{roleLabel}</Text>
      <Text style={styles.confidenceLabel}>
        {`${copy.confidenceLabel}: ${Math.round(classification.confidence * 100)}%`}
      </Text>
      <View style={styles.confidenceBar}>
        <View style={[styles.confidenceFill, { width: `${classification.confidence * 100}%` }]} />
      </View>
      {classification.matchedKeywords.length > 0 ? (
        <View style={styles.kwBlock}>
          <Text style={styles.kwHeader}>{copy.matchedHeader}</Text>
          <View style={styles.kwList}>
            {classification.matchedKeywords.map((kw) => (
              <View key={kw} style={styles.kwPill}>
                <Text style={styles.kwPillText}>{kw}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {lowConfidence ? <Text style={styles.lowConfHint}>{copy.lowConfidenceHint}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={onOverride}
        style={({ pressed }) => [styles.overrideBtn, pressed ? styles.overrideBtnPressed : null]}
      >
        <Text style={styles.overrideText}>{copy.overrideCta}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.earth100
  },
  header: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1
  },
  role: {
    color: colors.text,
    fontSize: fontSize.h2,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  confidenceLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  confidenceBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginTop: spacing.xs
  },
  confidenceFill: {
    height: '100%',
    backgroundColor: colors.gold
  },
  kwBlock: {
    marginTop: spacing.md
  },
  kwHeader: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1
  },
  kwList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs
  },
  kwPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.earth700,
    borderRadius: radius.pill
  },
  kwPillText: {
    color: colors.goldLight,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  lowConfHint: {
    marginTop: spacing.sm,
    color: colors.warn,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  overrideBtn: {
    marginTop: spacing.md,
    alignSelf: 'flex-start'
  },
  overrideBtnPressed: {
    opacity: 0.7
  },
  overrideText: {
    color: colors.goldDark,
    fontSize: fontSize.body,
    fontWeight: '700',
    textDecorationLine: 'underline'
  }
})
