import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-17'

interface FxQuote {
  readonly id: string
  readonly pair: string
  readonly rate: number
  readonly deltaPct: number
}

interface GoldHistory {
  readonly id: string
  readonly date: string
  readonly usdPerOz: number
}

const SPOT_USD_PER_OZ = 2360.4
const WEEKLY_AVG = 2331.8
const HOLD_THRESHOLD_PCT = -0.5

const SEED_FX: ReadonlyArray<FxQuote> = [
  { id: 'fx1', pair: 'USD / TZS', rate: 2615.0, deltaPct: 0.18 },
  { id: 'fx2', pair: 'EUR / TZS', rate: 2842.5, deltaPct: -0.07 },
  { id: 'fx3', pair: 'KES / TZS', rate: 19.62, deltaPct: 0.31 },
  { id: 'fx4', pair: 'CNY / TZS', rate: 360.4, deltaPct: 0.02 }
]

const SEED_HISTORY: ReadonlyArray<GoldHistory> = [
  { id: 'h1', date: '20 Mei', usdPerOz: 2298.1 },
  { id: 'h2', date: '22 Mei', usdPerOz: 2317.0 },
  { id: 'h3', date: '24 Mei', usdPerOz: 2342.6 },
  { id: 'h4', date: '26 Mei', usdPerOz: 2360.4 }
]

type Decision = 'sell' | 'hold'

export default function Screen(): JSX.Element {
  const [decision, setDecision] = useState<Decision>('sell')

  const deltaPct = useMemo<number>(() => {
    return Number((((SPOT_USD_PER_OZ - WEEKLY_AVG) / WEEKLY_AVG) * 100).toFixed(2))
  }, [])

  const recommendation = useMemo<string>(() => {
    if (deltaPct >= 1) return 'Bei iko juu — pendekezo: UZA leo'
    if (deltaPct <= HOLD_THRESHOLD_PCT) return 'Bei chini ya wastani — pendekezo: HIFADHI'
    return 'Bei iko karibu na wastani — angalia tena baada ya saa 6'
  }, [deltaPct])

  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Bei ya dhahabu — sasa">
          <BigNumber
            value={`USD ${SPOT_USD_PER_OZ.toFixed(0)} / oz`}
            label="Bei ya soko (London PM fix)"
            caption={`Tofauti na wastani wa wiki: ${deltaPct >= 0 ? '+' : ''}${deltaPct}%`}
          />
        </Section>
        <Section title="Historia ya wiki">
          <PlaceholderList
            items={SEED_HISTORY.map((h) => ({
              id: h.id,
              primary: `${h.date} · USD ${h.usdPerOz.toFixed(1)} / oz`,
              secondary: h.usdPerOz >= WEEKLY_AVG ? 'Juu ya wastani' : 'Chini ya wastani'
            }))}
          />
        </Section>
        <Section title="Sarafu na ubadilishaji">
          <PlaceholderList
            items={SEED_FX.map((q) => ({
              id: q.id,
              primary: q.pair,
              secondary: `${q.rate.toFixed(2)} · ${q.deltaPct >= 0 ? '+' : ''}${q.deltaPct}% leo`
            }))}
          />
        </Section>
        <Section title="Uamuzi — uza au hifadhi">
          <Text style={styles.recText}>{recommendation}</Text>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Chagua kuuza"
              onPress={() => setDecision('sell')}
              style={[styles.action, decision === 'sell' && styles.sell]}
            >
              <Text style={[styles.actionLabel, decision === 'sell' && styles.actionLabelActive]}>Uza</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Chagua kuhifadhi"
              onPress={() => setDecision('hold')}
              style={[styles.action, decision === 'hold' && styles.hold]}
            >
              <Text style={[styles.actionLabel, decision === 'hold' && styles.actionLabelActive]}>Hifadhi</Text>
            </Pressable>
          </View>
          <Text style={styles.footer}>
            Chaguo: {decision === 'sell' ? 'UZA leo kwa kiasi cha kilo 2.5' : 'HIFADHI hadi bei ipande zaidi'}
          </Text>
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
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
