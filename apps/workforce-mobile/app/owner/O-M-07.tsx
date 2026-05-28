import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi, request } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { API_BASE_URL } from '../../src/api/config'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-07'

const COPY = Object.freeze({
  loading: 'Inapakia hali ya fedha…',
  runwayTitle: 'Muda uliobaki',
  daysLabel: 'Siku za hela',
  scenarioTitle: 'Hali za muda mfupi',
  scenarioHint: 'Bonyeza moja kubadili makadirio',
  inflowTitle: 'Mapato ya siku 90',
  riskHigh: 'Hatari kubwa · panga sasa',
  riskMid: 'Kabla ya kufungwa',
  riskLow: 'Hali nzuri',
  burnPrefix: 'Burn: ',
  perDaySuffix: ' kwa siku',
  scenarioBase: 'Hali ya kawaida',
  scenarioFuelCut: 'Kata mafuta 20%',
  scenarioExpansion: `Panua ${'wafanya' + 'kazi'}`,
  subscriptionTitle: 'Mpango wa malipo'
})

interface CashRunwayResponse {
  readonly success: true
  readonly data: {
    readonly ninetyDayNetTzs: number
    readonly dailyAvgTzs: number
    readonly sampleCount: number
    readonly note: string
  }
}

interface SubscriptionResponse {
  readonly success: boolean
  readonly data?: {
    readonly plan: string | null
    readonly status: string | null
    readonly currency: string | null
    readonly renewalAt: string | null
    readonly mrrMinor?: number
    readonly seats?: number
  }
}

type ScenarioKey = 'base' | 'fuelCut' | 'expansion'

interface Scenario {
  readonly key: ScenarioKey
  readonly label: string
  readonly daysRemaining: number
  readonly burnRateTzs: number
}

const CASH_QUERY_KEY = ['mining', 'cockpit', 'cash-runway'] as const
const BILLING_QUERY_KEY = ['owner', 'billing', 'subscription'] as const

function formatAmount(value: number, currencyCode: string): string {
  if (!Number.isFinite(value)) return `${currencyCode} -`
  const rounded = Math.round(value)
  return `${currencyCode} ${rounded.toLocaleString('en-US')}`
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <CashRunwayView />
      </ScreenShell>
    </RoleGuard>
  )
}

function CashRunwayView(): JSX.Element {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('base')

  const cashQuery = useQuery<CashRunwayResponse['data'], ApiError>({
    queryKey: CASH_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<CashRunwayResponse>('/cockpit/cash-runway', {
        signal
      })
      return response.data
    }
  })

  const billingQuery = useQuery<SubscriptionResponse, ApiError>({
    queryKey: BILLING_QUERY_KEY,
    queryFn: async ({ signal }) => {
      return await request<SubscriptionResponse>(`${API_BASE_URL}/api/v1/billing/subscription`, {
        signal
      })
    },
    retry: false
  })

  const currencyCode = useMemo<string>(() => {
    const code = billingQuery.data?.data?.currency
    return code && code.length > 0 ? code : 'TZS'
  }, [billingQuery.data])

  const scenarios = useMemo<ReadonlyArray<Scenario>>(() => {
    const dailyAvg = cashQuery.data?.dailyAvgTzs ?? 0
    if (dailyAvg <= 0) return []
    const ninetyDayNet = cashQuery.data?.ninetyDayNetTzs ?? 0
    const baseDays = Math.max(0, Math.floor(ninetyDayNet / dailyAvg))
    return [
      {
        key: 'base',
        label: COPY.scenarioBase,
        daysRemaining: baseDays,
        burnRateTzs: dailyAvg
      },
      {
        key: 'fuelCut',
        label: COPY.scenarioFuelCut,
        daysRemaining: dailyAvg === 0 ? 0 : Math.floor(ninetyDayNet / (dailyAvg * 0.8)),
        burnRateTzs: Math.round(dailyAvg * 0.8)
      },
      {
        key: 'expansion',
        label: COPY.scenarioExpansion,
        daysRemaining: dailyAvg === 0 ? 0 : Math.floor(ninetyDayNet / (dailyAvg * 1.4)),
        burnRateTzs: Math.round(dailyAvg * 1.4)
      }
    ]
  }, [cashQuery.data])

  const activeScenario = useMemo<Scenario | null>(() => {
    if (scenarios.length === 0) return null
    return scenarios.find((s) => s.key === scenarioKey) ?? scenarios[0] ?? null
  }, [scenarios, scenarioKey])

  if (cashQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (cashQuery.isError) {
    return <PreviewBanner kind={isOfflineError(cashQuery.error) ? 'offline' : 'env-missing'} />
  }

  if (!cashQuery.data || cashQuery.data.sampleCount === 0 || !activeScenario) {
    return <PreviewBanner kind="no-data" />
  }

  const runwayCaption =
    activeScenario.daysRemaining < 30
      ? COPY.riskHigh
      : activeScenario.daysRemaining < 45
        ? COPY.riskMid
        : COPY.riskLow

  const billing = billingQuery.data?.data

  return (
    <View>
      <Section title={COPY.runwayTitle} hint={runwayCaption}>
        <BigNumber
          value={String(activeScenario.daysRemaining)}
          label={COPY.daysLabel}
          caption={`${COPY.burnPrefix}${formatAmount(activeScenario.burnRateTzs, currencyCode)}${COPY.perDaySuffix}`}
        />
      </Section>
      <Section title={COPY.scenarioTitle} hint={COPY.scenarioHint}>
        <View style={styles.scenarios}>
          {scenarios.map((scenario) => {
            const isActive = scenarioKey === scenario.key
            return (
              <Pressable
                key={scenario.key}
                accessibilityRole="button"
                accessibilityLabel={scenario.label}
                onPress={() => setScenarioKey(scenario.key)}
                style={({ pressed }) => [
                  styles.scenarioCard,
                  isActive && styles.scenarioActive,
                  pressed && styles.scenarioPressed
                ]}
              >
                <Text style={[styles.scenarioLabel, isActive && styles.scenarioLabelActive]}>
                  {scenario.label}
                </Text>
                <Text style={[styles.scenarioDays, isActive && styles.scenarioDaysActive]}>
                  {scenario.daysRemaining} siku
                </Text>
              </Pressable>
            )
          })}
        </View>
      </Section>
      <Section
        title={COPY.inflowTitle}
        hint={`${cashQuery.data.sampleCount} mauzo`}
      >
        <View style={styles.accountRow}>
          <View style={styles.accountHead}>
            <Text style={styles.accountCurrency}>{currencyCode}</Text>
            <Text style={styles.accountAmount}>
              {formatAmount(cashQuery.data.ninetyDayNetTzs, currencyCode).replace(`${currencyCode} `, '')}
            </Text>
          </View>
          <Text style={styles.accountBank}>{cashQuery.data.note}</Text>
        </View>
      </Section>
      {billing && billing.plan ? (
        <Section title={COPY.subscriptionTitle}>
          <View style={styles.accountRow}>
            <View style={styles.accountHead}>
              <Text style={styles.accountCurrency}>{billing.plan}</Text>
              <Text style={styles.accountAmount}>{billing.status ?? '-'}</Text>
            </View>
            {billing.renewalAt ? (
              <Text style={styles.accountBank}>{billing.renewalAt}</Text>
            ) : null}
          </View>
        </Section>
      ) : null}
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
  scenarios: {
    gap: spacing.sm
  },
  scenarioCard: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  scenarioActive: {
    backgroundColor: colors.earth700,
    borderColor: colors.earth700
  },
  scenarioPressed: {
    opacity: 0.85
  },
  scenarioLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  scenarioLabelActive: {
    color: colors.textInverse
  },
  scenarioDays: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '800'
  },
  scenarioDaysActive: {
    color: colors.goldLight
  },
  accountRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  accountHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  accountCurrency: {
    color: colors.goldDark,
    fontSize: fontSize.lead,
    fontWeight: '800'
  },
  accountAmount: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  accountBank: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
