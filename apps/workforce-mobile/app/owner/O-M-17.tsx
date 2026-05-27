import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-17'

const COPY = Object.freeze({
  loading: 'Inapakia bei za soko…',
  spotTitle: 'Bei ya soko ya kuuza',
  spotLabel: 'USD kwa kilo (wastani wa siku 90)',
  spotCaption: 'Tofauti na wastani wa wiki: ',
  historyTitle: 'Mwendo wa mauzo',
  fxTitle: 'FX iliyorekodiwa kwenye mauzo',
  decisionTitle: 'Uamuzi — uza au hifadhi',
  recHigh: 'Bei iko juu — pendekezo: UZA leo',
  recLow: 'Bei chini ya wastani — pendekezo: HIFADHI',
  recMid: 'Bei iko karibu na wastani — angalia tena baada ya saa 6',
  pickSell: 'Uza',
  pickHold: 'Hifadhi',
  decisionSell: 'Chaguo: UZA mara mzigo unaopatikana sasa',
  decisionHold: 'Chaguo: HIFADHI hadi bei ipande zaidi',
  juuLabel: 'Juu ya wastani',
  chiniLabel: 'Chini ya wastani'
})

interface SaleRow {
  readonly id: string
  readonly parcelId: string
  readonly grossPriceUsd: string | null
  readonly fxAtSaleTzsPerUsd: string | null
  readonly ts: string
}

interface ParcelRow {
  readonly id: string
  readonly massKg: string | null
}

interface SalesResponse {
  readonly success: true
  readonly data: ReadonlyArray<SaleRow>
}

interface ParcelsResponse {
  readonly success: true
  readonly data: ReadonlyArray<ParcelRow>
}

interface PriceObs {
  readonly date: string
  readonly pricePerKgUsd: number
  readonly aboveAvg: boolean
}

interface FxObs {
  readonly id: string
  readonly date: string
  readonly rate: number
}

type Decision = 'sell' | 'hold'

const SALES_KEY = ['mining', 'sales', 'all'] as const
const PARCELS_KEY = ['mining', 'ore-parcels', 'all'] as const
const HOLD_THRESHOLD_PCT = -0.5

function toNumber(value: string | null): number {
  if (value == null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(5, 10)
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <FxGoldWindow />
      </ScreenShell>
    </RoleGuard>
  )
}

function FxGoldWindow(): JSX.Element {
  const [decision, setDecision] = useState<Decision>('sell')

  const salesQuery = useQuery<ReadonlyArray<SaleRow>, ApiError>({
    queryKey: SALES_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<SalesResponse>('/sales', { signal })
      return response.data
    }
  })

  const parcelsQuery = useQuery<ReadonlyArray<ParcelRow>, ApiError>({
    queryKey: PARCELS_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<ParcelsResponse>('/ore-parcels', { signal })
      return response.data
    }
  })

  const massByParcel = useMemo<ReadonlyMap<string, number>>(() => {
    const map = new Map<string, number>()
    for (const parcel of parcelsQuery.data ?? []) {
      map.set(parcel.id, toNumber(parcel.massKg))
    }
    return map
  }, [parcelsQuery.data])

  const priceHistory = useMemo<ReadonlyArray<PriceObs>>(() => {
    const sales = salesQuery.data ?? []
    const rows: Array<{ date: string; pricePerKgUsd: number; ts: number }> = []
    for (const sale of sales) {
      const usd = toNumber(sale.grossPriceUsd)
      const mass = massByParcel.get(sale.parcelId) ?? 0
      if (usd <= 0 || mass <= 0) continue
      rows.push({
        date: dayLabel(sale.ts),
        pricePerKgUsd: usd / mass,
        ts: new Date(sale.ts).getTime()
      })
    }
    rows.sort((a, b) => a.ts - b.ts)
    if (rows.length === 0) return []
    const avg = rows.reduce((s, r) => s + r.pricePerKgUsd, 0) / rows.length
    return rows.map((r) => ({
      date: r.date,
      pricePerKgUsd: Number(r.pricePerKgUsd.toFixed(2)),
      aboveAvg: r.pricePerKgUsd >= avg
    }))
  }, [salesQuery.data, massByParcel])

  const avgPricePerKgUsd = useMemo<number>(() => {
    if (priceHistory.length === 0) return 0
    const total = priceHistory.reduce((s, r) => s + r.pricePerKgUsd, 0)
    return total / priceHistory.length
  }, [priceHistory])

  const latestPricePerKgUsd = useMemo<number>(() => {
    if (priceHistory.length === 0) return 0
    return priceHistory[priceHistory.length - 1]!.pricePerKgUsd
  }, [priceHistory])

  const deltaPct = useMemo<number>(() => {
    if (avgPricePerKgUsd === 0 || latestPricePerKgUsd === 0) return 0
    return Number((((latestPricePerKgUsd - avgPricePerKgUsd) / avgPricePerKgUsd) * 100).toFixed(2))
  }, [avgPricePerKgUsd, latestPricePerKgUsd])

  const recommendation = useMemo<string>(() => {
    if (deltaPct >= 1) return COPY.recHigh
    if (deltaPct <= HOLD_THRESHOLD_PCT) return COPY.recLow
    return COPY.recMid
  }, [deltaPct])

  const fxObservations = useMemo<ReadonlyArray<FxObs>>(() => {
    const sales = salesQuery.data ?? []
    const seen: Array<FxObs> = []
    for (const sale of sales) {
      const rate = toNumber(sale.fxAtSaleTzsPerUsd)
      if (rate <= 0) continue
      seen.push({
        id: sale.id,
        date: dayLabel(sale.ts),
        rate: Number(rate.toFixed(2))
      })
    }
    return seen.slice(0, 8)
  }, [salesQuery.data])

  if (salesQuery.isLoading || parcelsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (salesQuery.isError || parcelsQuery.isError) {
    const err = salesQuery.error ?? parcelsQuery.error
    return <PreviewBanner kind={isOfflineError(err) ? 'offline' : 'env-missing'} />
  }

  if (priceHistory.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  return (
    <View>
      <Section title={COPY.spotTitle}>
        <BigNumber
          value={`USD ${latestPricePerKgUsd.toFixed(2)}`}
          label={COPY.spotLabel}
          caption={`${COPY.spotCaption}${deltaPct >= 0 ? '+' : ''}${deltaPct}%`}
        />
      </Section>
      <Section title={COPY.historyTitle}>
        <PlaceholderList
          items={priceHistory.map((h) => ({
            id: `${h.date}-${h.pricePerKgUsd}`,
            primary: `${h.date} · USD ${h.pricePerKgUsd.toFixed(2)} / kg`,
            secondary: h.aboveAvg ? COPY.juuLabel : COPY.chiniLabel
          }))}
        />
      </Section>
      {fxObservations.length > 0 ? (
        <Section title={COPY.fxTitle}>
          <PlaceholderList
            items={fxObservations.map((q) => ({
              id: q.id,
              primary: `${q.date} · TZS/USD`,
              secondary: q.rate.toFixed(2)
            }))}
          />
        </Section>
      ) : null}
      <Section title={COPY.decisionTitle}>
        <Text style={styles.recText}>{recommendation}</Text>
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Chagua kuuza"
            onPress={() => setDecision('sell')}
            style={[styles.action, decision === 'sell' && styles.sell]}
          >
            <Text style={[styles.actionLabel, decision === 'sell' && styles.actionLabelActive]}>
              {COPY.pickSell}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Chagua kuhifadhi"
            onPress={() => setDecision('hold')}
            style={[styles.action, decision === 'hold' && styles.hold]}
          >
            <Text style={[styles.actionLabel, decision === 'hold' && styles.actionLabelActive]}>
              {COPY.pickHold}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.footer}>
          {decision === 'sell' ? COPY.decisionSell : COPY.decisionHold}
        </Text>
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
  recText: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600',
    marginBottom: spacing.md
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md
  },
  action: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center'
  },
  sell: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  hold: {
    backgroundColor: colors.earth700,
    borderColor: colors.earth900
  },
  actionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  actionLabelActive: {
    color: colors.earth900
  },
  footer: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.md
  }
})
