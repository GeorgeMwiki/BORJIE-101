import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { request } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { API_BASE_URL } from '../../src/api/config'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-14'

const COPY = Object.freeze({
  loading: 'Inapakia bidhaa za ghala…',
  tabAll: 'Zote',
  tabCritical: 'Hatari',
  tabLow: 'Chini',
  tabOk: 'Salama',
  summaryPrefix: 'Hatari ',
  summaryMid: ' - Chini ',
  summaryEnd: ' - Salama ',
  reorderQueue: 'Foleni ya kuagiza: ',
  daysSuffix: ' zilizobaki',
  daysUnknown: 'Siku haijulikani',
  queueAdd: 'Weka kwenye foleni ya kuagiza',
  queueAdded: 'Imewekwa kwenye foleni',
  perDay: ' kwa siku',
  dailyUse: 'Tumia kila siku '
})

type Tab = 'all' | 'critical' | 'low' | 'ok'

const TAB_ORDER: ReadonlyArray<Tab> = ['all', 'critical', 'low', 'ok']

const TAB_LABEL: Readonly<Record<Tab, string>> = {
  all: COPY.tabAll,
  critical: COPY.tabCritical,
  low: COPY.tabLow,
  ok: COPY.tabOk
}

interface WarehouseItem {
  readonly id: string
  readonly sku: string
  readonly name: string
  readonly category: string
  readonly quantity?: number | null
  readonly unitOfMeasure?: string | null
  readonly warehouseLocation?: string | null
  readonly condition?: string | null
  readonly averageDailyConsumption?: number | null
  readonly reorderLevel?: number | null
  readonly metadata?: Record<string, unknown> | null
}

interface WarehouseListResponse {
  readonly success: true
  readonly data: ReadonlyArray<WarehouseItem>
}

type Status = 'critical' | 'low' | 'ok'

const QUERY_KEY = ['warehouse', 'items'] as const

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function dailyConsumption(item: WarehouseItem): number {
  if (typeof item.averageDailyConsumption === 'number') return item.averageDailyConsumption
  const meta = item.metadata
  if (meta) {
    return (
      readNumber(meta.averageDailyConsumption) ||
      readNumber(meta.dailyUse) ||
      readNumber(meta.dailyConsumption)
    )
  }
  return 0
}

function reorderLevelOf(item: WarehouseItem): number {
  if (typeof item.reorderLevel === 'number') return item.reorderLevel
  const meta = item.metadata
  if (meta) {
    return readNumber(meta.reorderLevel)
  }
  return 0
}

function daysLeft(item: WarehouseItem): number | null {
  const use = dailyConsumption(item)
  if (use <= 0) return null
  const qty = item.quantity ?? 0
  return Math.floor(qty / use)
}

function statusOf(item: WarehouseItem): Status {
  const d = daysLeft(item)
  if (d === null) return 'ok'
  if (d <= 3) return 'critical'
  if (d <= 10) return 'low'
  return 'ok'
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <StoresAndPurchases />
      </ScreenShell>
    </RoleGuard>
  )
}

function StoresAndPurchases(): JSX.Element {
  const [tab, setTab] = useState<Tab>('all')
  const [reorderQueue, setReorderQueue] = useState<ReadonlyArray<string>>([])

  const query = useQuery<ReadonlyArray<WarehouseItem>, ApiError>({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await request<WarehouseListResponse>(
        `${API_BASE_URL}/api/v1/warehouse/items`,
        { signal }
      )
      return response.data
    }
  })

  const items = query.data ?? []

  const counts = useMemo(() => {
    return items.reduce(
      (acc, s) => {
        const st = statusOf(s)
        return { ...acc, [st]: acc[st] + 1 }
      },
      { critical: 0, low: 0, ok: 0 } as Readonly<Record<Status, number>>
    )
  }, [items])

  const visible = useMemo<ReadonlyArray<WarehouseItem>>(() => {
    if (tab === 'all') return items
    return items.filter((s) => statusOf(s) === tab)
  }, [items, tab])

  const queueReorder = useCallback((id: string): void => {
    setReorderQueue((current) =>
      current.includes(id) ? current.filter((q) => q !== id) : [...current, id]
    )
  }, [])

  if (query.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    return <PreviewBanner kind={isOfflineError(query.error) ? 'offline' : 'env-missing'} />
  }

  if (items.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  return (
    <View>
      <Section title={`${COPY.summaryPrefix}${counts.critical}${COPY.summaryMid}${counts.low}${COPY.summaryEnd}${counts.ok}`}>
        <View style={styles.tabRow}>
          {TAB_ORDER.map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              accessibilityLabel={`Tab ${TAB_LABEL[t]}`}
              onPress={() => setTab(t)}
              style={[styles.tab, tab === t && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{TAB_LABEL[t]}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={`${COPY.reorderQueue}${reorderQueue.length}`}>
        {visible.map((item) => {
          const d = daysLeft(item)
          const st = statusOf(item)
          const queued = reorderQueue.includes(item.id)
          const useRate = dailyConsumption(item)
          const reorder = reorderLevelOf(item)
          const toneColor = st === 'critical' ? colors.danger : st === 'low' ? colors.warn : colors.success
          const unit = item.unitOfMeasure ?? ''
          return (
            <View key={item.id} style={[styles.card, { borderLeftColor: toneColor }]}>
              <Text style={styles.cardName}>{item.name}</Text>
              <Text style={styles.cardMeta}>
                {item.quantity ?? 0} {unit}
                {item.warehouseLocation ? ` - ${item.warehouseLocation}` : ''}
                {useRate > 0 ? ` - ${COPY.dailyUse}${useRate} ${unit}` : ''}
                {reorder > 0 ? ` - reorder ${reorder}` : ''}
              </Text>
              <Text style={[styles.cardDays, { color: toneColor }]}>
                {d === null ? COPY.daysUnknown : `Siku ${d}${COPY.daysSuffix}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Agiza ${item.name}`}
                onPress={() => queueReorder(item.id)}
                style={[styles.reorderBtn, queued && styles.reorderBtnActive]}
              >
                <Text style={[styles.reorderLabel, queued && styles.reorderLabelActive]}>
                  {queued ? COPY.queueAdded : COPY.queueAdd}
                </Text>
              </Pressable>
            </View>
          )
        })}
      </Section>
    </View>
  )
}

function isOfflineError(error: ApiError | null): boolean {
  return error !== null && error.status === 0
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  loadingLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  tabRow: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center'
  },
  tabActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  tabLabel: { color: colors.textMuted, fontSize: fontSize.caption, fontWeight: '600' },
  tabLabelActive: { color: colors.earth900 },
  card: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4
  },
  cardName: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  cardMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  cardDays: { fontSize: fontSize.body, fontWeight: '700', marginTop: spacing.xs },
  reorderBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center'
  },
  reorderBtnActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  reorderLabel: { color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  reorderLabelActive: { color: colors.earth900, fontWeight: '700' }
})
