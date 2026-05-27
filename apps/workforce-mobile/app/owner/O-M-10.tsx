import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-10'

const COPY = Object.freeze({
  loading: 'Inapakia mauzo…',
  filterTitle: 'Chuja kwa hatua',
  totalsPrefix: 'Jumla · ',
  totalsParcels: ' kontena',
  marketPriceLabel: 'Bei ya soko ya wastani: ',
  variancePrefix: 'Tofauti dhidi ya soko: ',
  noBuyer: 'Bila mnunuzi',
  stageAll: 'Zote',
  stageSampling: 'Sampuli',
  stageOffer: 'Bei imepokelewa',
  stageShipped: 'Imesafirishwa',
  statusPending: 'Inasubiri malipo',
  statusPartial: 'Sehemu',
  statusPaid: 'Imelipwa',
  statusCancelled: 'Imefutwa'
})

type ParcelStatus = 'in_stockpile' | 'in_transit' | 'at_buyer' | 'sold' | 'spoiled'
type PaymentStatus = 'pending' | 'partial' | 'paid' | 'cancelled'

interface ParcelRow {
  readonly id: string
  readonly siteId: string
  readonly massKg: string | null
  readonly grade: Record<string, unknown>
  readonly status: ParcelStatus
  readonly attributes: Record<string, unknown>
  readonly createdAt: string
}

interface SaleRow {
  readonly id: string
  readonly parcelId: string
  readonly buyerId: string | null
  readonly route: string
  readonly grossPriceUsd: string | null
  readonly grossPriceTzs: string | null
  readonly fxAtSaleTzsPerUsd: string | null
  readonly netTzs: string | null
  readonly paymentStatus: PaymentStatus
  readonly ts: string
}

interface ParcelsResponse {
  readonly success: true
  readonly data: ReadonlyArray<ParcelRow>
}

interface SalesResponse {
  readonly success: true
  readonly data: ReadonlyArray<SaleRow>
}

type StageFilter = 'all' | 'sampling' | 'offer' | 'shipped' | 'sold'

interface JoinedRow {
  readonly id: string
  readonly stage: StageFilter
  readonly mineralLabel: string
  readonly massKg: number
  readonly netTzs: number
  readonly grossUsd: number
  readonly fxRate: number
  readonly paymentStatus: PaymentStatus | null
  readonly buyerId: string | null
  readonly siteId: string
  readonly createdAt: string
}

const STAGE_ORDER: ReadonlyArray<StageFilter> = ['all', 'sampling', 'offer', 'shipped', 'sold']

const STAGE_LABEL: Readonly<Record<StageFilter, string>> = {
  all: COPY.stageAll,
  sampling: COPY.stageSampling,
  offer: COPY.stageOffer,
  shipped: COPY.stageShipped,
  sold: COPY.statusPaid
}

const PAYMENT_LABEL: Readonly<Record<PaymentStatus, string>> = {
  pending: COPY.statusPending,
  partial: COPY.statusPartial,
  paid: COPY.statusPaid,
  cancelled: COPY.statusCancelled
}

const PARCELS_KEY = ['mining', 'ore-parcels'] as const
const SALES_KEY = ['mining', 'sales'] as const

function toNumber(value: string | null | undefined): number {
  if (value == null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function pickMineralLabel(grade: Record<string, unknown>, attributes: Record<string, unknown>): string {
  const mineralFromAttrs = typeof attributes.mineral === 'string' ? attributes.mineral : null
  if (mineralFromAttrs) return mineralFromAttrs
  const keys = Object.keys(grade)
  if (keys.length === 0) return '-'
  const firstKey = keys[0]!
  return firstKey
}

function stageFromParcelStatus(status: ParcelStatus, hasSale: boolean): StageFilter {
  if (status === 'in_stockpile') return hasSale ? 'offer' : 'sampling'
  if (status === 'in_transit' || status === 'at_buyer') return 'shipped'
  if (status === 'sold') return 'sold'
  return 'sampling'
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SalesPipeline />
      </ScreenShell>
    </RoleGuard>
  )
}

function SalesPipeline(): JSX.Element {
  const [filter, setFilter] = useState<StageFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const parcelsQuery = useQuery<ReadonlyArray<ParcelRow>, ApiError>({
    queryKey: PARCELS_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<ParcelsResponse>('/ore-parcels', { signal })
      return response.data
    }
  })

  const salesQuery = useQuery<ReadonlyArray<SaleRow>, ApiError>({
    queryKey: SALES_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<SalesResponse>('/sales', { signal })
      return response.data
    }
  })

  const select = useCallback((id: string): void => {
    setSelectedId((current) => (current === id ? null : id))
  }, [])

  const joinedRows = useMemo<ReadonlyArray<JoinedRow>>(() => {
    if (!parcelsQuery.data || !salesQuery.data) return []
    const salesByParcel = new Map<string, SaleRow>()
    for (const sale of salesQuery.data) {
      salesByParcel.set(sale.parcelId, sale)
    }
    return parcelsQuery.data.map((parcel) => {
      const sale = salesByParcel.get(parcel.id) ?? null
      return {
        id: parcel.id,
        stage: stageFromParcelStatus(parcel.status, sale !== null),
        mineralLabel: pickMineralLabel(parcel.grade, parcel.attributes),
        massKg: toNumber(parcel.massKg),
        netTzs: toNumber(sale?.netTzs),
        grossUsd: toNumber(sale?.grossPriceUsd),
        fxRate: toNumber(sale?.fxAtSaleTzsPerUsd),
        paymentStatus: sale?.paymentStatus ?? null,
        buyerId: sale?.buyerId ?? null,
        siteId: parcel.siteId,
        createdAt: parcel.createdAt
      }
    })
  }, [parcelsQuery.data, salesQuery.data])

  const referencePricePerKgUsd = useMemo<number>(() => {
    const rows = joinedRows.filter((r) => r.grossUsd > 0 && r.massKg > 0)
    if (rows.length === 0) return 0
    const total = rows.reduce((sum, r) => sum + r.grossUsd / r.massKg, 0)
    return total / rows.length
  }, [joinedRows])

  const visible = useMemo<ReadonlyArray<JoinedRow>>(() => {
    if (filter === 'all') return joinedRows
    return joinedRows.filter((row) => row.stage === filter)
  }, [filter, joinedRows])

  const totals = useMemo(() => {
    return visible.reduce(
      (acc, row) => ({ netTzs: acc.netTzs + row.netTzs, count: acc.count + 1 }),
      { netTzs: 0, count: 0 }
    )
  }, [visible])

  if (parcelsQuery.isLoading || salesQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (parcelsQuery.isError || salesQuery.isError) {
    const err = parcelsQuery.error ?? salesQuery.error
    return <PreviewBanner kind={isOfflineError(err) ? 'offline' : 'env-missing'} />
  }

  if (joinedRows.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  return (
    <View>
      <Section title={COPY.filterTitle}>
        <View style={styles.chips}>
          {STAGE_ORDER.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              accessibilityLabel={`Chuja ${STAGE_LABEL[s]}`}
              onPress={() => setFilter(s)}
              style={[styles.chip, filter === s && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, filter === s && styles.chipLabelActive]}>
                {STAGE_LABEL[s]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={`${COPY.totalsPrefix}${totals.count}${COPY.totalsParcels} · TZS ${Math.round(totals.netTzs).toLocaleString('en-US')}`}>
        {visible.map((row) => {
          const isOpen = selectedId === row.id
          const marketUsd = referencePricePerKgUsd > 0 ? Math.round(referencePricePerKgUsd * row.massKg) : 0
          const variancePct =
            marketUsd === 0 || row.grossUsd === 0
              ? null
              : Math.round(((row.grossUsd - marketUsd) / marketUsd) * 100)
          return (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`Chagua ${row.id}`}
              onPress={() => select(row.id)}
              style={[styles.row, isOpen && styles.rowOpen]}
            >
              <Text style={styles.rowPrimary}>
                {row.id.slice(0, 8)} - {row.massKg} kg {row.mineralLabel}
              </Text>
              <Text style={styles.rowSecondary}>
                {STAGE_LABEL[row.stage]}
                {row.paymentStatus ? ` - ${PAYMENT_LABEL[row.paymentStatus]}` : ''}
                {' - '}
                {row.buyerId ?? COPY.noBuyer}
              </Text>
              {row.netTzs > 0 ? (
                <Text style={styles.rowMoney}>
                  Net TZS {Math.round(row.netTzs).toLocaleString('en-US')}
                </Text>
              ) : null}
              {isOpen ? (
                <View style={styles.detail}>
                  {marketUsd > 0 ? (
                    <Text style={styles.detailLine}>
                      {COPY.marketPriceLabel}USD {marketUsd.toLocaleString('en-US')}
                    </Text>
                  ) : null}
                  {variancePct !== null ? (
                    <Text
                      style={[
                        styles.detailLine,
                        variancePct >= 0 ? styles.positive : styles.negative
                      ]}
                    >
                      {COPY.variancePrefix}
                      {variancePct >= 0 ? '+' : ''}
                      {variancePct}%
                    </Text>
                  ) : null}
                  {row.fxRate > 0 ? (
                    <Text style={styles.detailLine}>FX: {row.fxRate.toFixed(2)}</Text>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </Section>
    </View>
  )
}

function isOfflineError(error: ApiError | null | undefined): boolean {
  return error != null && error.status === 0
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  loadingLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm
  },
  rowOpen: { borderColor: colors.gold, borderWidth: 1 },
  rowPrimary: { color: colors.text, fontSize: fontSize.lead, fontWeight: '600' },
  rowSecondary: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  rowMoney: { color: colors.goldDark, fontSize: fontSize.body, fontWeight: '700', marginTop: spacing.xs },
  detail: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1
  },
  detailLine: { color: colors.text, fontSize: fontSize.body, marginTop: spacing.xs },
  positive: { color: colors.success, fontWeight: '700' },
  negative: { color: colors.danger, fontWeight: '700' }
})
