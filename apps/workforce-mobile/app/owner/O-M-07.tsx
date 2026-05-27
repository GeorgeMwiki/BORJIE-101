import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-07'

type ScenarioKey = 'base' | 'fuelCut' | 'expansion'

interface Scenario {
  readonly key: ScenarioKey
  readonly label: string
  readonly daysRemaining: number
  readonly burnRatePerDay: number
}

interface CashAccount {
  readonly id: string
  readonly currency: 'TZS' | 'USD' | 'KES'
  readonly amount: number
  readonly bank: string
}

interface OutflowLine {
  readonly id: string
  readonly category: string
  readonly amountTzs: number
  readonly dueInDays: number
}

const ACCOUNTS: ReadonlyArray<CashAccount> = [
  { id: 'a1', currency: 'TZS', amount: 184_000_000, bank: 'CRDB Geita' },
  { id: 'a2', currency: 'USD', amount: 74_000, bank: 'NMB Mwanza' },
  { id: 'a3', currency: 'KES', amount: 2_100_000, bank: 'Equity Nairobi' }
]

const OUTFLOWS: ReadonlyArray<OutflowLine> = [
  { id: 'o1', category: 'Mishahara ya wafanyakazi', amountTzs: 42_000_000, dueInDays: 7 },
  { id: 'o2', category: 'Mafuta na vifaa', amountTzs: 28_500_000, dueInDays: 3 },
  { id: 'o3', category: 'Ada za leseni za PML', amountTzs: 18_000_000, dueInDays: 14 },
  { id: 'o4', category: 'Kodi ya forodha (TRA)', amountTzs: 21_400_000, dueInDays: 30 }
]

const BASE_SCENARIO: Scenario = {
  key: 'base',
  label: 'Hali ya kawaida',
  daysRemaining: 38,
  burnRatePerDay: 6_400_000
}

const SCENARIOS: ReadonlyArray<Scenario> = [
  BASE_SCENARIO,
  { key: 'fuelCut', label: 'Kata mafuta 20%', daysRemaining: 52, burnRatePerDay: 4_700_000 },
  { key: 'expansion', label: 'Panua wafanyakazi', daysRemaining: 24, burnRatePerDay: 9_100_000 }
]

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

  const activeScenario = useMemo<Scenario>(
    () => SCENARIOS.find((s) => s.key === scenarioKey) ?? BASE_SCENARIO,
    [scenarioKey]
  )

  const totalOutflowTzs = useMemo<number>(
    () => OUTFLOWS.reduce((sum, line) => sum + line.amountTzs, 0),
    []
  )

  const runwayCaption = useMemo<string>(() => {
    if (activeScenario.daysRemaining < 30) return 'Hatari kubwa · panga sasa'
    if (activeScenario.daysRemaining < 45) return 'Kabla ya kufungwa'
    return 'Hali nzuri'
  }, [activeScenario])

  return (
    <View>
      <Section title="Muda uliobaki" hint={runwayCaption}>
        <BigNumber
          value={String(activeScenario.daysRemaining)}
          label="Siku za hela"
          caption={`Burn: TZS ${formatThousands(activeScenario.burnRatePerDay)} kwa siku`}
        />
      </Section>
      <Section title="Hali za muda mfupi" hint="Bonyeza moja kubadili makadirio">
        <View style={styles.scenarios}>
          {SCENARIOS.map((scenario) => {
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
      <Section title="Mfuko kwa benki na sarafu">
        {ACCOUNTS.map((acc) => (
          <View key={acc.id} style={styles.accountRow}>
            <View style={styles.accountHead}>
              <Text style={styles.accountCurrency}>{acc.currency}</Text>
              <Text style={styles.accountAmount}>{formatThousands(acc.amount)}</Text>
            </View>
            <Text style={styles.accountBank}>{acc.bank}</Text>
          </View>
        ))}
      </Section>
      <Section title="Malipo yajayo" hint={`Jumla TZS ${formatThousands(totalOutflowTzs)}`}>
        {OUTFLOWS.map((line) => (
          <View key={line.id} style={styles.outflowRow}>
            <View style={styles.outflowMain}>
              <Text style={styles.outflowCategory}>{line.category}</Text>
              <Text style={styles.outflowAmount}>TZS {formatThousands(line.amountTzs)}</Text>
            </View>
            <Text style={[styles.outflowDue, dueStyle(line.dueInDays)]}>
              Siku {line.dueInDays}
            </Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

function formatThousands(value: number): string {
  return value.toLocaleString('en-US')
}

function dueStyle(days: number): { color: string } {
  if (days <= 7) return { color: colors.danger }
  if (days <= 14) return { color: colors.warn }
  return { color: colors.success }
}

const styles = StyleSheet.create({
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
  },
  outflowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  outflowMain: {
    flex: 1
  },
  outflowCategory: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  outflowAmount: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  outflowDue: {
    fontSize: fontSize.body,
    fontWeight: '700'
  }
})
