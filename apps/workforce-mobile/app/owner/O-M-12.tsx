import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-12'

interface MineHeadcount {
  id: string
  name: string
  permanent: number
  casual: number
  contractors: number
  presentToday: number
}

const MINES: ReadonlyArray<MineHeadcount> = [
  { id: 'geita', name: 'Geita', permanent: 18, casual: 6, contractors: 3, presentToday: 25 },
  { id: 'chunya', name: 'Chunya', permanent: 8, casual: 4, contractors: 1, presentToday: 11 },
  { id: 'mwanza', name: 'Mwanza', permanent: 5, casual: 4, contractors: 2, presentToday: 8 },
  { id: 'mbeya', name: 'Mbeya', permanent: 6, casual: 2, contractors: 0, presentToday: 7 }
]

type SortKey = 'name' | 'total' | 'present'

const SORT_LABEL: Readonly<Record<SortKey, string>> = {
  name: 'Jina',
  total: 'Jumla',
  present: 'Waliopo leo'
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PeopleByMine />
      </ScreenShell>
    </RoleGuard>
  )
}

function totalOf(mine: MineHeadcount): number {
  return mine.permanent + mine.casual + mine.contractors
}

function PeopleByMine(): JSX.Element {
  const [sortBy, setSortBy] = useState<SortKey>('total')
  const [expanded, setExpanded] = useState<string | null>(null)

  const sorted = useMemo<ReadonlyArray<MineHeadcount>>(() => {
    const copy = [...MINES]
    if (sortBy === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name))
    if (sortBy === 'present') return copy.sort((a, b) => b.presentToday - a.presentToday)
    return copy.sort((a, b) => totalOf(b) - totalOf(a))
  }, [sortBy])

  const totals = useMemo(() => {
    return MINES.reduce(
      (acc, m) => ({
        permanent: acc.permanent + m.permanent,
        casual: acc.casual + m.casual,
        contractors: acc.contractors + m.contractors,
        present: acc.present + m.presentToday
      }),
      { permanent: 0, casual: 0, contractors: 0, present: 0 }
    )
  }, [])

  const toggle = useCallback((id: string): void => {
    setExpanded((current) => (current === id ? null : id))
  }, [])

  const grandTotal = totals.permanent + totals.casual + totals.contractors

  return (
    <View>
      <Section title={`Jumla ya watu: ${grandTotal} - Waliopo leo: ${totals.present}`}>
        <View style={styles.summaryRow}>
          <SummaryPill label="Wa kudumu" value={totals.permanent} />
          <SummaryPill label="Wa muda" value={totals.casual} />
          <SummaryPill label="Wakandarasi" value={totals.contractors} />
        </View>
      </Section>
      <Section title="Panga kwa">
        <View style={styles.sortRow}>
          {(['name', 'total', 'present'] as ReadonlyArray<SortKey>).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`Panga kwa ${SORT_LABEL[key]}`}
              onPress={() => setSortBy(key)}
              style={[styles.sortChip, sortBy === key && styles.sortChipActive]}
            >
              <Text style={[styles.sortLabel, sortBy === key && styles.sortLabelActive]}>{SORT_LABEL[key]}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title="Migodi">
        {sorted.map((mine) => {
          const isOpen = expanded === mine.id
          const total = totalOf(mine)
          const presentPct = total === 0 ? 0 : Math.round((mine.presentToday / total) * 100)
          return (
            <Pressable
              key={mine.id}
              accessibilityRole="button"
              accessibilityLabel={`Onyesha ${mine.name}`}
              onPress={() => toggle(mine.id)}
              style={[styles.mineRow, isOpen && styles.mineRowOpen]}
            >
              <View style={styles.mineHeader}>
                <Text style={styles.mineName}>{mine.name}</Text>
                <Text style={styles.mineTotal}>{total}</Text>
              </View>
              <Text style={styles.mineMeta}>Waliopo leo: {mine.presentToday} ({presentPct}%)</Text>
              {isOpen ? (
                <View style={styles.mineDetail}>
                  <Text style={styles.detailLine}>Wa kudumu: {mine.permanent}</Text>
                  <Text style={styles.detailLine}>Wa muda: {mine.casual}</Text>
                  <Text style={styles.detailLine}>Wakandarasi: {mine.contractors}</Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </Section>
    </View>
  )
}

interface SummaryPillProps {
  label: string
  value: number
}

function SummaryPill({ label, value }: SummaryPillProps): JSX.Element {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillValue}>{value}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  pillValue: { color: colors.goldLight, fontSize: fontSize.h2, fontWeight: '800' },
  pillLabel: { color: colors.earth100, fontSize: fontSize.caption, marginTop: spacing.xs },
  sortRow: { flexDirection: 'row', gap: spacing.sm },
  sortChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1
  },
  sortChipActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  sortLabel: { color: colors.textMuted, fontSize: fontSize.caption, fontWeight: '600' },
  sortLabelActive: { color: colors.earth900 },
  mineRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  mineRowOpen: { borderColor: colors.gold, borderWidth: 1 },
  mineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mineName: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  mineTotal: { color: colors.goldDark, fontSize: fontSize.h3, fontWeight: '800' },
  mineMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  mineDetail: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },
  detailLine: { color: colors.text, fontSize: fontSize.body, marginTop: spacing.xs }
})
