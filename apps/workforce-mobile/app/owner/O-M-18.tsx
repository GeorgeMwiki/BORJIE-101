import { useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
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

const SCREEN_ID = 'O-M-18'

// USD-cliff date is platform policy (CLAUDE.md hard rule). Not seed data.
const USD_CLIFF_ISO = '2026-03-27'

const COPY = Object.freeze({
  loading: 'Inapakia hali ya 27-Machi…',
  cliffTitle: 'Hesabu ya mwisho — Machi 27, 2026',
  daysLabel: 'Siku hadi kuanza kwa sharti',
  daysLabelPast: 'Tarehe ya mwisho imepita',
  cliffNote: 'Mikataba ya ndani isiyo TZS itakataliwa baada ya tarehe hii',
  exposureTitle: 'Mfichuko wa fedha za kigeni',
  exposurePostPrefix: 'Mauzo baada ya tarehe: ',
  exposurePostMid: ' · yenye USD: ',
  exposureNothing: 'Hakuna mauzo bado',
  exposureGaugeSuffix: '% ya mauzo yapo katika USD',
  remediationDone: 'Mageuzi yamekamilika',
  remediationPending: 'Bado kuna mikataba ya USD',
  contractsTitle: 'Mikataba ya hivi karibuni',
  actionsTitle: 'Hatua zinazohitajika',
  actionRewriteTzs: 'Badili kwenda TZS',
  actionTzsContract: 'Tayari TZS',
  noContracts: 'Hakuna mikataba ya hivi karibuni'
})

interface CliffStatusResponse {
  readonly success: true
  readonly data: {
    readonly cliffDateIso: string
    readonly postCliffSales: number
    readonly usdDenominated: number
    readonly remediationComplete: boolean
    readonly note: string
  }
}

interface SaleRow {
  readonly id: string
  readonly buyerId: string | null
  readonly route: string
  readonly grossPriceUsd: string | null
  readonly grossPriceTzs: string | null
  readonly paymentStatus: string
  readonly ts: string
}

interface SalesResponse {
  readonly success: true
  readonly data: ReadonlyArray<SaleRow>
}

const CLIFF_KEY = ['mining', 'cockpit', '27mar-cliff'] as const
const SALES_KEY = ['mining', 'sales', 'cliff'] as const

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <CliffStatusView />
      </ScreenShell>
    </RoleGuard>
  )
}

function CliffStatusView(): JSX.Element {
  const cliffQuery = useQuery<CliffStatusResponse['data'], ApiError>({
    queryKey: CLIFF_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<CliffStatusResponse>('/cockpit/27mar-cliff-status', {
        signal
      })
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

  const daysRemaining = useMemo<number>(() => {
    const cliff = new Date(USD_CLIFF_ISO).getTime()
    const today = Date.now()
    return Math.max(0, Math.ceil((cliff - today) / 86_400_000))
  }, [])

  const exposurePct = useMemo<number>(() => {
    const data = cliffQuery.data
    if (!data || data.postCliffSales === 0) return 0
    return Math.round((data.usdDenominated / data.postCliffSales) * 100)
  }, [cliffQuery.data])

  if (cliffQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (cliffQuery.isError) {
    return <PreviewBanner kind={isOfflineError(cliffQuery.error) ? 'offline' : 'env-missing'} />
  }

  if (!cliffQuery.data) {
    return <PreviewBanner kind="no-data" />
  }

  const cliffData = cliffQuery.data
  const isPastCliff = daysRemaining === 0
  const sales = salesQuery.data ?? []
  const recentSales = sales.slice(0, 6)

  return (
    <View>
      <Section title={COPY.cliffTitle}>
        <BigNumber
          value={isPastCliff ? '0' : String(daysRemaining)}
          label={isPastCliff ? COPY.daysLabelPast : COPY.daysLabel}
          caption={COPY.cliffNote}
        />
      </Section>
      <Section title={COPY.exposureTitle}>
        <View style={styles.gauge}>
          <View style={styles.gaugeTrack}>
            <View
              style={[
                styles.gaugeFill,
                { width: `${exposurePct}%` },
                cliffData.remediationComplete ? styles.gaugeFillOk : styles.gaugeFillRisk
              ]}
            />
          </View>
          <Text style={styles.gaugeLabel}>
            {cliffData.postCliffSales === 0
              ? COPY.exposureNothing
              : `${exposurePct}${COPY.exposureGaugeSuffix}`}
          </Text>
          <Text style={styles.gaugeSub}>
            {COPY.exposurePostPrefix}
            {cliffData.postCliffSales}
            {COPY.exposurePostMid}
            {cliffData.usdDenominated}
          </Text>
          <Text style={styles.gaugeSub}>
            {cliffData.remediationComplete ? COPY.remediationDone : COPY.remediationPending}
          </Text>
        </View>
      </Section>
      <Section title={COPY.contractsTitle}>
        {recentSales.length === 0 ? (
          <PlaceholderList items={[]} emptyLabel={COPY.noContracts} />
        ) : (
          <PlaceholderList
            items={recentSales.map((sale) => {
              const usd = Number(sale.grossPriceUsd ?? '0')
              const isUsd = Number.isFinite(usd) && usd > 0
              return {
                id: sale.id,
                primary: `${sale.id.slice(0, 8)} · ${sale.route}`,
                secondary: isUsd
                  ? `USD ${usd.toLocaleString('en-US')} · ${COPY.actionRewriteTzs}`
                  : `${sale.paymentStatus} · ${COPY.actionTzsContract}`
              }
            })}
          />
        )}
      </Section>
      <Section title={COPY.actionsTitle}>
        <PlaceholderList
          items={
            cliffData.remediationComplete
              ? [
                  {
                    id: 'ok',
                    primary: COPY.remediationDone,
                    secondary: cliffData.note
                  }
                ]
              : [
                  {
                    id: 'open',
                    primary: COPY.remediationPending,
                    secondary: cliffData.note
                  }
                ]
          }
        />
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
  gauge: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.lg,
    borderRadius: radius.md
  },
  gaugeTrack: {
    height: 14,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  gaugeFill: {
    height: '100%'
  },
  gaugeFillRisk: {
    backgroundColor: colors.danger
  },
  gaugeFillOk: {
    backgroundColor: colors.success
  },
  gaugeLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginTop: spacing.sm
  },
  gaugeSub: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
