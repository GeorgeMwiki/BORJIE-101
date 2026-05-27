import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-18'

interface Contract {
  readonly id: string
  readonly counterparty: string
  readonly currency: 'USD' | 'TZS' | 'EUR'
  readonly valueTzs: number
  readonly needsRedenomination: boolean
  readonly daysToRenew: number
}

const CLIFF_DATE = '2026-03-27'
const TODAY = '2026-05-27'

const SEED_CONTRACTS: ReadonlyArray<Contract> = [
  { id: 'ct1', counterparty: 'AfriGold Refinery', currency: 'USD', valueTzs: 1_450_000_000, needsRedenomination: true, daysToRenew: 14 },
  { id: 'ct2', counterparty: 'Mwanza Smelter Ltd', currency: 'TZS', valueTzs: 820_000_000, needsRedenomination: false, daysToRenew: 92 },
  { id: 'ct3', counterparty: 'Dubai Bullion DMCC', currency: 'USD', valueTzs: 2_300_000_000, needsRedenomination: true, daysToRenew: 30 },
  { id: 'ct4', counterparty: 'BoT Gold Buy-Back', currency: 'TZS', valueTzs: 1_100_000_000, needsRedenomination: false, daysToRenew: 180 },
  { id: 'ct5', counterparty: 'Geita Off-Take Co-op', currency: 'EUR', valueTzs: 460_000_000, needsRedenomination: true, daysToRenew: 7 }
]

export default function Screen(): JSX.Element {
  const daysRemaining = useMemo<number>(() => {
    const cliff = new Date(CLIFF_DATE).getTime()
    const today = new Date(TODAY).getTime()
    return Math.max(0, Math.ceil((cliff - today) / 86_400_000))
  }, [])

  const exposureSummary = useMemo(() => {
    const total = SEED_CONTRACTS.reduce((acc, c) => acc + c.valueTzs, 0)
    const exposed = SEED_CONTRACTS
      .filter((c) => c.needsRedenomination)
      .reduce((acc, c) => acc + c.valueTzs, 0)
    const exposedPct = Math.round((exposed / total) * 100)
    return { total, exposed, exposedPct }
  }, [])

  const isPastCliff = daysRemaining === 0

  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Hesabu ya mwisho — Machi 27, 2026">
          <BigNumber
            value={isPastCliff ? '0' : String(daysRemaining)}
            label={isPastCliff ? 'Tarehe ya mwisho imepita' : 'Siku hadi kuanza kwa sharti'}
            caption="Mikataba ya ndani isiyo TZS itakataliwa baada ya tarehe hii"
          />
        </Section>
        <Section title="Mfichuko wa fedha za kigeni">
          <View style={styles.gauge}>
            <View style={styles.gaugeTrack}>
              <View style={[styles.gaugeFill, { width: `${exposureSummary.exposedPct}%` }]} />
            </View>
            <Text style={styles.gaugeLabel}>
              {exposureSummary.exposedPct}% ya jumla iko hatarini ({SEED_CONTRACTS.filter((c) => c.needsRedenomination).length} mikataba)
            </Text>
            <Text style={styles.gaugeSub}>
              Thamani iliyo hatarini: TZS {(exposureSummary.exposed / 1_000_000_000).toFixed(2)}B / {(exposureSummary.total / 1_000_000_000).toFixed(2)}B
            </Text>
          </View>
        </Section>
        <Section title="Mikataba ya sasa">
          <PlaceholderList
            items={SEED_CONTRACTS.map((c) => ({
              id: c.id,
              primary: `${c.counterparty} · ${c.currency}`,
              secondary: c.needsRedenomination
                ? `Inahitaji kubadilishwa kwenda TZS · upya kwa siku ${c.daysToRenew}`
                : `Safi · TZS · upya kwa siku ${c.daysToRenew}`
            }))}
          />
        </Section>
        <Section title="Hatua zinazohitajika">
          <PlaceholderList
            items={[
              { id: 'a1', primary: 'Andika upya AfriGold Refinery', secondary: 'Kipaumbele cha juu · siku 14' },
              { id: 'a2', primary: 'Pata makubaliano ya Dubai Bullion DMCC', secondary: 'Tuma rasimu kwa wakili' },
              { id: 'a3', primary: 'Wasiliana na Geita Off-Take', secondary: 'Mkutano umepangwa wiki ijayo' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
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
    height: '100%',
    backgroundColor: colors.danger
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
