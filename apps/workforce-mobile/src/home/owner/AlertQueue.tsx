import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { MAX_DECISIONS, type DecisionItem } from './types'

export interface AlertQueueProps {
  readonly items: ReadonlyArray<DecisionItem>
  readonly lang: 'sw' | 'en'
  readonly onTriage?: (id: string) => void
}

/**
 * Slot 2 — Needs Review queue. Capped at MAX_DECISIONS (≤5) per spec §A.
 * Sorted high → amber → info by the composer hook. Empty state collapses
 * the whole row to avoid the "zero-state spam" anti-pattern. Each row is
 * a 44pt+ tap target (Apple HIG / Pajamas accessibility rule).
 */
export function AlertQueue({ items, lang, onTriage }: AlertQueueProps): JSX.Element | null {
  if (items.length === 0) {
    return null
  }
  const capped = items.slice(0, MAX_DECISIONS)
  return (
    <View testID="owner-home-alert-queue" style={styles.wrap}>
      <Text style={styles.header}>
        {lang === 'sw' ? `Inahitaji uangalizi · ${capped.length}` : `Needs review · ${capped.length}`}
      </Text>
      {capped.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={lang === 'sw' ? item.titleSw : item.titleEn}
          onPress={onTriage ? () => onTriage(item.id) : undefined}
          style={({ pressed }) => [
            styles.row,
            rowAccent(item.severity),
            pressed ? styles.rowPressed : null
          ]}
        >
          <Text style={styles.rowTitle}>
            {lang === 'sw' ? item.titleSw : item.titleEn}
          </Text>
          <Text style={styles.rowAction}>
            {lang === 'sw' ? 'Fungua' : 'Open'}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function rowAccent(severity: DecisionItem['severity']): { borderLeftColor: string } {
  if (severity === 'high') {
    return { borderLeftColor: colors.danger }
  }
  if (severity === 'amber') {
    return { borderLeftColor: colors.warn }
  }
  return { borderLeftColor: colors.earth500 }
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg
  },
  header: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  row: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  rowPressed: {
    opacity: 0.7
  },
  rowTitle: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
    flex: 1
  },
  rowAction: {
    color: colors.goldDark,
    fontSize: fontSize.body,
    fontWeight: '700',
    marginLeft: spacing.md
  }
})
