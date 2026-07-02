import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-12'

type Om12Copy = ReturnType<typeof useI18n>['t']['ownerScreens']['om12']

type SortKey = 'name' | 'total' | 'present'

function sortLabelOf(key: SortKey, copy: Om12Copy): string {
  if (key === 'name') return copy.sortName
  if (key === 'total') return copy.sortTotal
  return copy.sortPresent
}

const SORT_KEYS: ReadonlyArray<SortKey> = ['name', 'total', 'present']

interface SiteHeadcount {
  readonly id: string
  readonly name: string
  readonly permanent: number
  readonly casual: number
  readonly contractors: number
  readonly presentToday: number
}

interface HeadcountResponse {
  readonly success?: boolean
  readonly data?: ReadonlyArray<SiteHeadcount>
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

function totalOf(mine: SiteHeadcount): number {
  return mine.permanent + mine.casual + mine.contractors
}

function useHeadcount(): UseQueryResult<ReadonlyArray<SiteHeadcount>, Error> {
  return useQuery<ReadonlyArray<SiteHeadcount>, Error>({
    queryKey: ['mining', 'attendance', 'headcount', 'site'],
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<HeadcountResponse>(
        '/attendance/headcount',
        { signal, query: { groupBy: 'site' } }
      )
      const rows = Array.isArray(response?.data) ? response.data : []
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        permanent: Number(row.permanent ?? 0),
        casual: Number(row.casual ?? 0),
        contractors: Number(row.contractors ?? 0),
        presentToday: Number(row.presentToday ?? 0)
      }))
    },
    staleTime: 60_000
  })
}

function PeopleByMine(): JSX.Element {
  const { t } = useI18n()
  const copy = t.ownerScreens.om12
  const [sortBy, setSortBy] = useState<SortKey>('total')
  const [expanded, setExpanded] = useState<string | null>(null)
  const query = useHeadcount()

  const sorted = useMemo<ReadonlyArray<SiteHeadcount>>(() => {
    const rows = query.data ?? []
    const copy = [...rows]
    if (sortBy === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name))
    if (sortBy === 'present') return copy.sort((a, b) => b.presentToday - a.presentToday)
    return copy.sort((a, b) => totalOf(b) - totalOf(a))
  }, [query.data, sortBy])

  const totals = useMemo(() => {
    const rows = query.data ?? []
    return rows.reduce(
      (acc, m) => ({
        permanent: acc.permanent + m.permanent,
        casual: acc.casual + m.casual,
        contractors: acc.contractors + m.contractors,
        present: acc.present + m.presentToday
      }),
      { permanent: 0, casual: 0, contractors: 0, present: 0 }
    )
  }, [query.data])

  const toggle = useCallback((id: string): void => {
    setExpanded((current) => (current === id ? null : id))
  }, [])

  if (query.isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingText}>{copy.loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : -1
    const kind = status === 0 ? 'offline' : 'env-missing'
    return (
      <View>
        <PreviewBanner kind={kind} />
      </View>
    )
  }

  if (sorted.length === 0) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
      </View>
    )
  }

  const grandTotal = totals.permanent + totals.casual + totals.contractors

  return (
    <View>
      <Section title={`${copy.summaryTotalPrefix}${grandTotal} - ${copy.summaryPresentPrefix}${totals.present}`}>
        <View style={styles.summaryRow}>
          <SummaryPill label={copy.permanent} value={totals.permanent} />
          <SummaryPill label={copy.casual} value={totals.casual} />
          <SummaryPill label={copy.contractors} value={totals.contractors} />
        </View>
      </Section>
      <Section title={copy.sortBy}>
        <View style={styles.sortRow}>
          {SORT_KEYS.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${copy.sortByPrefix}${sortLabelOf(key, copy)}`}
              onPress={() => setSortBy(key)}
              style={[styles.sortChip, sortBy === key && styles.sortChipActive]}
            >
              <Text style={[styles.sortLabel, sortBy === key && styles.sortLabelActive]}>
                {sortLabelOf(key, copy)}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={copy.mines}>
        {sorted.map((mine) => {
          const isOpen = expanded === mine.id
          const total = totalOf(mine)
          const presentPct = total === 0 ? 0 : Math.round((mine.presentToday / total) * 100)
          return (
            <Pressable
              key={mine.id}
              accessibilityRole="button"
              accessibilityLabel={`${copy.showPrefix}${mine.name}`}
              onPress={() => toggle(mine.id)}
              style={[styles.mineRow, isOpen && styles.mineRowOpen]}
            >
              <View style={styles.mineHeader}>
                <Text style={styles.mineName}>{mine.name}</Text>
                <Text style={styles.mineTotal}>{total}</Text>
              </View>
              <Text style={styles.mineMeta}>
                {copy.presentToday}: {mine.presentToday} ({presentPct}%)
              </Text>
              {isOpen ? (
                <View style={styles.mineDetail}>
                  <Text style={styles.detailLine}>{copy.permanent}: {mine.permanent}</Text>
                  <Text style={styles.detailLine}>{copy.casual}: {mine.casual}</Text>
                  <Text style={styles.detailLine}>{copy.contractors}: {mine.contractors}</Text>
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
  readonly label: string
  readonly value: number
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
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { color: colors.textMuted, fontSize: fontSize.body },
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
