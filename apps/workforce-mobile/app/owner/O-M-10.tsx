import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-10'

type Stage = 'sampling' | 'offer' | 'shipped' | 'paid'

interface Parcel {
  id: string
  label: string
  mineral: string
  grade: string
  weightKg: number
  netUsd: number
  buyer: string
  stage: Stage
  spotUsdPerKg: number
}

const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  sampling: 'Sampuli',
  offer: 'Bei imepokelewa',
  shipped: 'Imesafirishwa',
  paid: 'Imelipwa'
}

const PARCELS: ReadonlyArray<Parcel> = [
  { id: 'P-001', label: 'Parcel 001', mineral: 'Au', grade: '12 g/t', weightKg: 2400, netUsd: 38200, buyer: 'GeoFin TZ', stage: 'offer', spotUsdPerKg: 63.2 },
  { id: 'P-002', label: 'Parcel 002', mineral: 'Cu', grade: '24%', weightKg: 1100, netUsd: 6800, buyer: 'Mwanza Smelt', stage: 'sampling', spotUsdPerKg: 6.18 },
  { id: 'P-003', label: 'Parcel 003', mineral: 'Au', grade: '8 g/t', weightKg: 1850, netUsd: 24400, buyer: 'Arusha Refinery', stage: 'shipped', spotUsdPerKg: 64.1 },
  { id: 'P-004', label: 'Parcel 004', mineral: 'Tanzanite', grade: 'AAA', weightKg: 4.2, netUsd: 18900, buyer: 'Block-D Jewels', stage: 'paid', spotUsdPerKg: 4500 }
]

const STAGE_ORDER: ReadonlyArray<Stage | 'all'> = ['all', 'sampling', 'offer', 'shipped', 'paid']

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
  const [filter, setFilter] = useState<Stage | 'all'>('all')
  const [selected, setSelected] = useState<string | null>(null)

  const visible = useMemo<ReadonlyArray<Parcel>>(
    () => (filter === 'all' ? PARCELS : PARCELS.filter((p) => p.stage === filter)),
    [filter]
  )

  const totals = useMemo(() => {
    return visible.reduce(
      (acc, p) => ({ net: acc.net + p.netUsd, count: acc.count + 1 }),
      { net: 0, count: 0 }
    )
  }, [visible])

  const select = useCallback((id: string): void => {
    setSelected((current) => (current === id ? null : id))
  }, [])

  return (
    <View>
      <Section title="Chuja kwa hatua">
        <View style={styles.chips}>
          {STAGE_ORDER.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              accessibilityLabel={`Chuja ${s}`}
              onPress={() => setFilter(s)}
              style={[styles.chip, filter === s && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, filter === s && styles.chipLabelActive]}>
                {s === 'all' ? 'Zote' : STAGE_LABEL[s]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={`Jumla · ${totals.count} kontena · USD ${totals.net.toLocaleString()}`}>
        {visible.map((p) => {
          const isOpen = selected === p.id
          const marketUsd = Math.round(p.weightKg * p.spotUsdPerKg)
          const variancePct = marketUsd === 0 ? 0 : Math.round(((p.netUsd - marketUsd) / marketUsd) * 100)
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Chagua ${p.label}`}
              onPress={() => select(p.id)}
              style={[styles.row, isOpen && styles.rowOpen]}
            >
              <Text style={styles.rowPrimary}>
                {p.label} - {p.weightKg} kg {p.mineral} ({p.grade})
              </Text>
              <Text style={styles.rowSecondary}>
                {STAGE_LABEL[p.stage]} - Mnunuzi: {p.buyer}
              </Text>
              <Text style={styles.rowMoney}>Net USD {p.netUsd.toLocaleString()}</Text>
              {isOpen ? (
                <View style={styles.detail}>
                  <Text style={styles.detailLine}>Bei ya soko: USD {marketUsd.toLocaleString()}</Text>
                  <Text style={[styles.detailLine, variancePct >= 0 ? styles.positive : styles.negative]}>
                    Tofauti dhidi ya soko: {variancePct >= 0 ? '+' : ''}{variancePct}%
                  </Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
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
