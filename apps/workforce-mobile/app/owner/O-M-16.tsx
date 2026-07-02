import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-16'
const CSR_ENDPOINT_PATH = '/api/v1/mining/csr-plans'

type Om16Copy = ReturnType<typeof useI18n>['t']['ownerScreens']['om16']

function categoryLabel(category: GrievanceCategory, copy: Om16Copy): string {
  if (category === 'noise') return copy.catNoise
  if (category === 'dust') return copy.catDust
  if (category === 'water') return copy.catWater
  if (category === 'land') return copy.catLand
  if (category === 'wages') return copy.catWages
  if (category === 'housing') return copy.catHousing
  if (category === 'access') return copy.catAccess
  return copy.catOther
}

function raisedByLabel(kind: RaisedByKind, copy: Om16Copy): string {
  if (kind === 'worker') return copy.raisedByWorker
  if (kind === 'villager') return copy.raisedByVillager
  if (kind === 'landowner') return copy.raisedByLandowner
  if (kind === 'community_leader') return copy.raisedByCommunityLeader
  if (kind === 'local_govt') return copy.raisedByLocalGovt
  return copy.raisedByNgo
}

type GrievanceCategory =
  | 'noise'
  | 'dust'
  | 'water'
  | 'land'
  | 'wages'
  | 'housing'
  | 'access'
  | 'other'

type RaisedByKind =
  | 'worker'
  | 'villager'
  | 'landowner'
  | 'community_leader'
  | 'local_govt'
  | 'ngo'

interface GrievanceRow {
  readonly id: string
  readonly siteId: string | null
  readonly raisedByKind: RaisedByKind
  readonly raisedByName: string | null
  readonly category: GrievanceCategory
  readonly summary: string
  readonly status: string
  readonly raisedAt: string
}

interface GrievancesResponse {
  readonly success: true
  readonly data: ReadonlyArray<GrievanceRow>
}

const QUERY_KEY = ['mining', 'grievances', 'all'] as const
const MS_PER_DAY = 24 * 60 * 60 * 1000

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <CommunityRelations />
      </ScreenShell>
    </RoleGuard>
  )
}

function CommunityRelations(): JSX.Element {
  const { t } = useI18n()
  const copy = t.ownerScreens.om16
  const [filter, setFilter] = useState<'all' | 'open'>('all')
  const query = useQuery<ReadonlyArray<GrievanceRow>, ApiError>({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<GrievancesResponse>('/grievances/', { signal })
      return response.data
    }
  })

  const grievances = query.data ?? []

  const filtered = useMemo(() => {
    if (filter === 'open') {
      return grievances.filter((row) => !isResolved(row.status))
    }
    return grievances
  }, [grievances, filter])

  return (
    <View>
      <Section title={copy.csrTitle}>
        <PreviewBanner kind="env-missing" />
        <Text style={styles.missingPath}>{CSR_ENDPOINT_PATH}</Text>
        <View style={styles.csrSummary}>
          <BigNumber value="—" label={copy.csrLabel} />
        </View>
      </Section>
      <Section title={copy.grievancesTitle}>
        {renderGrievancesContent(query.isLoading, query.isError, query.error, grievances, filtered, filter, setFilter, copy)}
      </Section>
    </View>
  )
}

function renderGrievancesContent(
  isLoading: boolean,
  isError: boolean,
  error: ApiError | null,
  all: ReadonlyArray<GrievanceRow>,
  filtered: ReadonlyArray<GrievanceRow>,
  filter: 'all' | 'open',
  setFilter: (next: 'all' | 'open') => void,
  copy: Om16Copy
): JSX.Element {
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{copy.loading}</Text>
      </View>
    )
  }
  if (isError) {
    return <PreviewBanner kind={isOfflineError(error) ? 'offline' : 'env-missing'} />
  }
  if (all.length === 0) {
    return <PreviewBanner kind="no-data" />
  }
  const now = Date.now()
  return (
    <View>
      <View style={styles.toggleRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.filterAllAccessibility}
          onPress={() => setFilter('all')}
          style={[styles.toggle, filter === 'all' && styles.toggleActive]}
        >
          <Text style={[styles.toggleLabel, filter === 'all' && styles.toggleLabelActive]}>
            {copy.filterAll}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.filterOpenAccessibility}
          onPress={() => setFilter('open')}
          style={[styles.toggle, filter === 'open' && styles.toggleActive]}
        >
          <Text style={[styles.toggleLabel, filter === 'open' && styles.toggleLabelActive]}>
            {copy.filterOpen}
          </Text>
        </Pressable>
      </View>
      <PlaceholderList
        items={filtered.map((row) => ({
          id: row.id,
          primary: `${categoryLabel(row.category, copy)} - ${row.summary}`,
          secondary: secondaryLabel(row, now, copy)
        }))}
        emptyLabel={copy.emptyGrievances}
      />
    </View>
  )
}

function secondaryLabel(row: GrievanceRow, now: number, copy: Om16Copy): string {
  if (isResolved(row.status)) {
    return copy.closedLabel
  }
  const raised = Date.parse(row.raisedAt)
  if (!Number.isFinite(raised)) {
    return copy.unresolvedLabel
  }
  const days = Math.max(0, Math.floor((now - raised) / MS_PER_DAY))
  return `${copy.openLabel} - ${raisedByLabel(row.raisedByKind, copy)} - ${copy.daysPrefix} ${days}`
}

function isResolved(status: string): boolean {
  return status === 'resolved' || status === 'withdrawn'
}

function isOfflineError(error: ApiError | null): boolean {
  return error !== null && error.status === 0
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.lg, alignItems: 'center' },
  loadingLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  missingPath: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontFamily: 'monospace',
    marginBottom: spacing.sm
  },
  csrSummary: {
    marginTop: spacing.sm
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  toggle: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt
  },
  toggleActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  toggleLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  toggleLabelActive: {
    color: colors.earth900
  }
})
