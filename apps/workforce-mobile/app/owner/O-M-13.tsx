import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-13'

const COPY = Object.freeze({
  loading: 'Inapakia data ya mali...',
  summary: (total: number, avg: number, dueSoon: number): string =>
    `Mali ${total} - Wastani wa matumizi ${avg}% - ${dueSoon} zinahitaji huduma`,
  list: 'Orodha ya mali',
  all: 'Zote',
  kindLabel: 'Aina',
  siteLabel: 'Mgodi',
  idLabel: 'Kitambulisho',
  overdue: (days: number): string => `Huduma imechelewa siku ${days}`,
  now: 'Huduma sasa',
  soon: (days: number): string => `Huduma baada ya siku ${days}`,
  ok: (days: number): string => `Huduma baada ya siku ${days}`,
  noDate: 'Huduma haijapangwa'
})

type AssetKind = 'excavator' | 'truck' | 'drill' | 'generator' | 'pump' | 'crusher' | 'compressor' | 'vehicle' | 'tool' | 'ppe' | 'other'

interface MaintenanceEventRow {
  readonly id: string
  readonly assetId: string
  readonly kind: string
  readonly status: string
  readonly summary: string | null
  readonly downtimeHours: string | null
  readonly costTzs: string | null
  readonly scheduledFor: string | null
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly createdAt: string
}

interface MaintenanceListResponse {
  readonly success?: boolean
  readonly data?: ReadonlyArray<MaintenanceEventRow>
}

interface DerivedAsset {
  readonly id: string
  readonly label: string
  readonly kind: string
  readonly utilizationPct: number
  readonly nextServiceDueDate: string | null
  readonly lastServiceDate: string | null
  readonly serviceDueInDays: number | null
  readonly site: string
}

const FILTERS: ReadonlyArray<AssetKind | 'all'> = [
  'all',
  'excavator',
  'truck',
  'drill',
  'generator',
  'pump'
]

const KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  excavator: 'Excavator',
  truck: 'Truck',
  drill: 'Drill',
  generator: 'Jenereta',
  pump: 'Pampu',
  crusher: 'Crusher',
  compressor: 'Compressor',
  vehicle: 'Gari',
  tool: 'Zana',
  ppe: 'PPE',
  other: 'Nyingine'
})

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <AssetsAndVehicles />
      </ScreenShell>
    </RoleGuard>
  )
}

function serviceTone(days: number | null): { label: string; color: string } {
  if (days === null) return { label: COPY.noDate, color: colors.textMuted }
  if (days < 0) return { label: COPY.overdue(Math.abs(days)), color: colors.danger }
  if (days === 0) return { label: COPY.now, color: colors.warn }
  if (days <= 7) return { label: COPY.soon(days), color: colors.warn }
  return { label: COPY.ok(days), color: colors.success }
}

function kindLabelOf(kind: string): string {
  return KIND_LABEL[kind] ?? kind
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const target = Date.parse(iso)
  if (!Number.isFinite(target)) return null
  return Math.floor((target - Date.now()) / 86_400_000)
}

function deriveAssets(events: ReadonlyArray<MaintenanceEventRow>, filter: AssetKind | 'all'): ReadonlyArray<DerivedAsset> {
  const byAsset = new Map<string, MaintenanceEventRow[]>()
  for (const event of events) {
    const bucket = byAsset.get(event.assetId)
    if (bucket) {
      bucket.push(event)
    } else {
      byAsset.set(event.assetId, [event])
    }
  }
  const result: DerivedAsset[] = []
  for (const [assetId, rows] of byAsset.entries()) {
    const completed = rows.filter((r) => r.completedAt !== null)
    const lastService = completed
      .map((r) => r.completedAt)
      .filter((d): d is string => d !== null)
      .sort()
      .pop() ?? null
    const upcoming = rows
      .filter((r) => r.scheduledFor !== null && r.status !== 'completed' && r.status !== 'cancelled')
      .map((r) => r.scheduledFor)
      .filter((d): d is string => d !== null)
      .sort()
    const nextService = upcoming[0] ?? null
    const openCount = rows.filter((r) => r.status === 'open' || r.status === 'in_progress').length
    const utilizationPct = openCount === 0 ? 100 : Math.max(0, 100 - openCount * 15)
    const dominantKind = rows[0]?.kind ?? 'other'
    const derived: DerivedAsset = {
      id: assetId,
      label: assetId,
      kind: dominantKind,
      utilizationPct,
      nextServiceDueDate: nextService,
      lastServiceDate: lastService,
      serviceDueInDays: daysUntil(nextService),
      site: '-'
    }
    if (filter === 'all' || derived.kind === filter) {
      result.push(derived)
    }
  }
  return result
}

function useMaintenanceEvents(): UseQueryResult<ReadonlyArray<MaintenanceEventRow>, Error> {
  return useQuery<ReadonlyArray<MaintenanceEventRow>, Error>({
    queryKey: ['mining', 'maintenance', 'events'],
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<MaintenanceListResponse>('/maintenance', {
        signal,
        query: { limit: 500 }
      })
      return Array.isArray(response?.data) ? response.data : []
    },
    staleTime: 60_000
  })
}

function AssetsAndVehicles(): JSX.Element {
  const [filter, setFilter] = useState<AssetKind | 'all'>('all')
  const [opened, setOpened] = useState<string | null>(null)
  const query = useMaintenanceEvents()

  const visible = useMemo<ReadonlyArray<DerivedAsset>>(
    () => deriveAssets(query.data ?? [], filter),
    [query.data, filter]
  )

  const fleet = useMemo(() => {
    const total = visible.length
    const avg = total === 0 ? 0 : Math.round(visible.reduce((acc, a) => acc + a.utilizationPct, 0) / total)
    const dueSoon = visible.filter((a) => a.serviceDueInDays !== null && a.serviceDueInDays <= 7).length
    return { total, avg, dueSoon }
  }, [visible])

  const open = useCallback((id: string): void => {
    setOpened((current) => (current === id ? null : id))
  }, [])

  if (query.isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingText}>{COPY.loading}</Text>
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

  if ((query.data ?? []).length === 0) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
      </View>
    )
  }

  return (
    <View>
      <Section title={COPY.summary(fleet.total, fleet.avg, fleet.dueSoon)}>
        <View style={styles.filterRow}>
          {FILTERS.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={`Chuja ${k}`}
              onPress={() => setFilter(k)}
              style={[styles.chip, filter === k && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, filter === k && styles.chipLabelActive]}>
                {k === 'all' ? COPY.all : kindLabelOf(k)}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={COPY.list}>
        {visible.length === 0 ? (
          <PreviewBanner kind="no-data" />
        ) : (
          visible.map((asset) => {
            const tone = serviceTone(asset.serviceDueInDays)
            const isOpen = opened === asset.id
            const utilBar = Math.max(2, Math.min(100, asset.utilizationPct))
            return (
              <Pressable
                key={asset.id}
                accessibilityRole="button"
                accessibilityLabel={`Onyesha ${asset.label}`}
                onPress={() => open(asset.id)}
                style={[styles.row, isOpen && styles.rowOpen]}
              >
                <View style={styles.rowHeader}>
                  <Text style={styles.rowLabel}>{asset.label}</Text>
                  <Text style={styles.rowUtil}>{asset.utilizationPct}%</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${utilBar}%` }]} />
                </View>
                <Text style={[styles.serviceLine, { color: tone.color }]}>{tone.label}</Text>
                {isOpen ? (
                  <View style={styles.detail}>
                    <Text style={styles.detailLine}>{COPY.kindLabel}: {kindLabelOf(asset.kind)}</Text>
                    <Text style={styles.detailLine}>{COPY.siteLabel}: {asset.site}</Text>
                    <Text style={styles.detailLine}>{COPY.idLabel}: {asset.id}</Text>
                  </View>
                ) : null}
              </Pressable>
            )
          })
        )}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { color: colors.textMuted, fontSize: fontSize.body },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1
  },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  chipLabel: { color: colors.textMuted, fontSize: fontSize.caption, fontWeight: '600' },
  chipLabelActive: { color: colors.earth900 },
  row: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  rowOpen: { borderColor: colors.gold, borderWidth: 1 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  rowUtil: { color: colors.goldDark, fontSize: fontSize.h3, fontWeight: '800' },
  barTrack: {
    marginTop: spacing.sm,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.earth100,
    overflow: 'hidden'
  },
  barFill: { height: '100%', backgroundColor: colors.gold },
  serviceLine: { marginTop: spacing.sm, fontSize: fontSize.body, fontWeight: '600' },
  detail: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },
  detailLine: { color: colors.text, fontSize: fontSize.body, marginTop: spacing.xs }
})
