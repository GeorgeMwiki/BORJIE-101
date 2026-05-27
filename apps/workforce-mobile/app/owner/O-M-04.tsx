import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-04'

const COPY = Object.freeze({
  loading: 'Inapakia ramani ya portfolio…',
  errorInline: 'Ombi la portfolio limeshindwa kuthibitishwa.',
  emptyHint: 'Hakuna leseni au tovuti zilizosajiliwa kwenye akaunti yako.',
  sectionMap: 'Ramani ya portifolio',
  sectionMapHint: 'Polygons + rangi za hali · bonyeza kuchagua',
  sectionFilter: 'Chuja kwa hali',
  sectionList: 'Migodi',
  unknown: 'Haijulikani'
})

type FeatureLayer = 'site' | 'licence'
type FilterKey = 'all' | 'active' | 'working' | 'pending' | 'expired'
type MineStatus = Exclude<FilterKey, 'all'>

interface PortfolioFeature {
  readonly type: 'Feature'
  readonly geometry: Readonly<Record<string, unknown>>
  readonly properties: Readonly<Record<string, unknown>>
}

interface PortfolioMapResponse {
  readonly type: 'FeatureCollection'
  readonly features: ReadonlyArray<PortfolioFeature>
  readonly layers: {
    readonly sites: number
    readonly licences: number
    readonly settlements: number
    readonly protectedAreas: number
  }
}

interface ApiEnvelope<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: { code?: string; message?: string }
}

interface NormalizedMine {
  readonly id: string
  readonly label: string
  readonly region: string
  readonly mineral: string
  readonly layer: FeatureLayer
  readonly status: MineStatus
  readonly rawStatus: string
}

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Zote' },
  { key: 'active', label: 'Hai' },
  { key: 'working', label: 'Kazi' },
  { key: 'pending', label: 'Subiri' },
  { key: 'expired', label: 'Imekwisha' }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PortfolioMapView />
      </ScreenShell>
    </RoleGuard>
  )
}

function PortfolioMapView(): JSX.Element {
  const query = useQuery<PortfolioMapResponse, Error>({
    queryKey: ['mining', 'portfolio-map'],
    queryFn: async ({ signal }) => {
      const envelope = await miningApi.get<ApiEnvelope<PortfolioMapResponse>>(
        '/portfolio-map',
        { signal }
      )
      if (!envelope.success || !envelope.data) {
        throw new Error(envelope.error?.message ?? COPY.errorInline)
      }
      return envelope.data
    }
  })

  const mines = useMemo<ReadonlyArray<NormalizedMine>>(() => {
    if (!query.data) return []
    return query.data.features.map((feature, index) => normalize(feature, index))
  }, [query.data])

  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const visible = useMemo<ReadonlyArray<NormalizedMine>>(
    () => (filter === 'all' ? mines : mines.filter((m) => m.status === filter)),
    [filter, mines]
  )

  const totals = useMemo<Record<MineStatus, number>>(() => {
    const counts: Record<MineStatus, number> = {
      active: 0,
      working: 0,
      pending: 0,
      expired: 0
    }
    mines.forEach((m) => {
      counts[m.status] += 1
    })
    return counts
  }, [mines])

  if (query.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    return (
      <View>
        {isBackendUnavailable(query.error) ? (
          <PreviewBanner kind="env-missing" />
        ) : (
          <Text style={styles.errorInline}>{COPY.errorInline}</Text>
        )}
      </View>
    )
  }

  if (mines.length === 0) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
        <Text style={styles.emptyHint}>{COPY.emptyHint}</Text>
      </View>
    )
  }

  return (
    <View>
      <Section title={COPY.sectionMap} hint={COPY.sectionMapHint}>
        <View style={styles.mapBox}>
          <View style={styles.mapGrid}>
            {mines.map((mine) => (
              <Pressable
                key={mine.id}
                accessibilityRole="button"
                accessibilityLabel={`${mine.label} ${mine.region}`}
                onPress={() => setSelectedId(mine.id)}
                style={({ pressed }) => [
                  styles.polygon,
                  { backgroundColor: statusColor(mine.status) },
                  pressed && styles.polygonPressed,
                  selectedId === mine.id && styles.polygonSelected
                ]}
              >
                <Text style={styles.polygonLabel}>{mine.label}</Text>
                <Text style={styles.polygonRegion}>{mine.region}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.legend}>
            <LegendDot status="active" label={`Hai (${totals.active})`} />
            <LegendDot status="working" label={`Kazi (${totals.working})`} />
            <LegendDot status="pending" label={`Subiri (${totals.pending})`} />
            <LegendDot status="expired" label={`Kwisha (${totals.expired})`} />
          </View>
        </View>
      </Section>
      <Section title={COPY.sectionFilter}>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              accessibilityRole="button"
              accessibilityLabel={f.label}
              onPress={() => setFilter(f.key)}
              style={({ pressed }) => [
                styles.chip,
                filter === f.key && styles.chipActive,
                pressed && styles.chipPressed
              ]}
            >
              <Text style={[styles.chipLabel, filter === f.key && styles.chipLabelActive]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={`${COPY.sectionList} (${visible.length})`}>
        {visible.map((mine) => (
          <Pressable
            key={mine.id}
            accessibilityRole="button"
            accessibilityLabel={mine.label}
            onPress={() => setSelectedId(mine.id)}
            style={({ pressed }) => [
              styles.row,
              selectedId === mine.id && styles.rowSelected,
              pressed && styles.rowPressed
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: statusColor(mine.status) }]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>
                {mine.label} · {statusLabel(mine.status)}
              </Text>
              <Text style={styles.rowMeta}>
                {mine.region} · {mine.mineral} · {mine.layer === 'site' ? 'tovuti' : 'leseni'}
              </Text>
            </View>
          </Pressable>
        ))}
      </Section>
    </View>
  )
}

function LegendDot({
  status,
  label
}: {
  status: MineStatus
  label: string
}): JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: statusColor(status) }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  )
}

function statusColor(status: MineStatus): string {
  if (status === 'active') return colors.success
  if (status === 'working') return colors.gold
  if (status === 'pending') return colors.warn
  return colors.danger
}

function statusLabel(status: MineStatus): string {
  if (status === 'active') return 'hai'
  if (status === 'working') return 'kazi'
  if (status === 'pending') return 'subiri'
  return 'imekwisha'
}

function normalize(feature: PortfolioFeature, index: number): NormalizedMine {
  const props = feature.properties ?? {}
  const layer: FeatureLayer = props['layer'] === 'licence' ? 'licence' : 'site'
  const rawIdValue = props['id']
  const rawId = typeof rawIdValue === 'string' ? rawIdValue : null
  const id = rawId ?? `feature-${index}`
  const numberValue = props['number']
  const nameValue = props['name']
  const label =
    layer === 'licence' && typeof numberValue === 'string'
      ? numberValue
      : typeof nameValue === 'string' && nameValue.length > 0
        ? nameValue
        : id.slice(0, 8)
  const region = pickRegion(feature)
  const mineralValue = props['mineral']
  const mineral = typeof mineralValue === 'string' && mineralValue.length > 0
    ? mineralValue
    : COPY.unknown
  const rawStatus = pickStatus(props)
  return {
    id,
    label,
    region,
    mineral,
    layer,
    status: mapStatus(rawStatus, props),
    rawStatus: rawStatus ?? ''
  }
}

function pickStatus(props: Readonly<Record<string, unknown>>): string | null {
  const value = props['status']
  return typeof value === 'string' ? value : null
}

function pickRegion(feature: PortfolioFeature): string {
  const props = feature.properties ?? {}
  const candidates = ['region', 'district', 'province', 'phase'] as const
  for (const key of candidates) {
    const value = props[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return COPY.unknown
}

function mapStatus(
  raw: string | null,
  props: Readonly<Record<string, unknown>>
): MineStatus {
  if (!raw) return 'pending'
  const normalized = raw.toLowerCase()
  if (normalized === 'expired' || normalized === 'cancelled' || normalized === 'revoked') {
    return 'expired'
  }
  if (normalized === 'pending' || normalized === 'pending_review' || normalized === 'submitted') {
    return 'pending'
  }
  if (normalized === 'production' || normalized === 'producing' || normalized === 'working') {
    return 'working'
  }
  if (normalized === 'active' || normalized === 'approved' || normalized === 'valid') {
    return 'active'
  }
  const expiry = props['expiryDate']
  if (typeof expiry === 'string') {
    const expiryMs = Date.parse(expiry)
    if (Number.isFinite(expiryMs) && expiryMs < Date.now()) return 'expired'
  }
  return 'pending'
}

function isBackendUnavailable(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (error instanceof ApiError) return error.status >= 500 || error.status === 503
  return false
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    paddingVertical: spacing.xl
  },
  loadingLabel: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  errorInline: {
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginVertical: spacing.md
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  mapBox: {
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  mapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  polygon: {
    width: '31%',
    minHeight: 70,
    borderRadius: radius.md,
    padding: spacing.sm,
    justifyContent: 'center'
  },
  polygonPressed: {
    opacity: 0.8
  },
  polygonSelected: {
    borderWidth: 3,
    borderColor: colors.earth900
  },
  polygonLabel: {
    color: colors.textInverse,
    fontSize: fontSize.lead,
    fontWeight: '800'
  },
  polygonRegion: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  legend: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill
  },
  legendLabel: {
    color: colors.text,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border
  },
  chipActive: {
    backgroundColor: colors.earth700,
    borderColor: colors.earth700
  },
  chipPressed: {
    opacity: 0.7
  },
  chipLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  chipLabelActive: {
    color: colors.textInverse
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  rowSelected: {
    borderWidth: 2,
    borderColor: colors.gold
  },
  rowPressed: {
    opacity: 0.85
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill
  },
  rowBody: {
    flex: 1
  },
  rowTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
