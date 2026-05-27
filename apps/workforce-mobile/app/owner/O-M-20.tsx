import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-20'

type MineralKind = 'all' | 'gold' | 'copper' | 'tanzanite' | 'coal'

interface Listing {
  readonly id: string
  readonly title: string
  readonly mineral: Exclude<MineralKind, 'all'>
  readonly location: string
  readonly rating: number
  readonly priceTzs: number
  readonly unit: string
  readonly verified: boolean
}

const SEED_LISTINGS: ReadonlyArray<Listing> = [
  { id: 'm1', title: 'Mzigo wa dhahabu ghafi · 1.2 kg', mineral: 'gold', location: 'Geita', rating: 4.7, priceTzs: 178_500_000, unit: 'kg', verified: true },
  { id: 'm2', title: 'Concentrate ya shaba · tani 8', mineral: 'copper', location: 'Mwanza', rating: 4.4, priceTzs: 84_200_000, unit: 'tani', verified: true },
  { id: 'm3', title: 'Tanzanite zilizosafishwa · karati 150', mineral: 'tanzanite', location: 'Mererani', rating: 4.9, priceTzs: 240_000_000, unit: 'karati', verified: true },
  { id: 'm4', title: 'Makaa ya mawe · tani 50', mineral: 'coal', location: 'Mbeya', rating: 4.1, priceTzs: 31_500_000, unit: 'tani', verified: false },
  { id: 'm5', title: 'Dhahabu doré · 600 g', mineral: 'gold', location: 'Chunya', rating: 4.6, priceTzs: 86_700_000, unit: 'g', verified: true },
  { id: 'm6', title: 'Tanzanite ghafi · karati 80', mineral: 'tanzanite', location: 'Arusha', rating: 4.3, priceTzs: 96_400_000, unit: 'karati', verified: false }
]

const FILTERS: ReadonlyArray<{ kind: MineralKind; label: string }> = [
  { kind: 'all', label: 'Zote' },
  { kind: 'gold', label: 'Dhahabu' },
  { kind: 'copper', label: 'Shaba' },
  { kind: 'tanzanite', label: 'Tanzanite' },
  { kind: 'coal', label: 'Makaa' }
]

export default function Screen(): JSX.Element {
  const [filter, setFilter] = useState<MineralKind>('all')
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false)

  const visible = useMemo<ReadonlyArray<Listing>>(() => {
    const byKind = filter === 'all' ? SEED_LISTINGS : SEED_LISTINGS.filter((l) => l.mineral === filter)
    if (!verifiedOnly) return byKind
    return byKind.filter((l) => l.verified)
  }, [filter, verifiedOnly])

  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Chuja kwa aina ya madini">
          <View style={styles.filterRow}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.kind}
                accessibilityRole="button"
                accessibilityLabel={`Chuja ${f.label}`}
                onPress={() => setFilter(f.kind)}
                style={[styles.chip, filter === f.kind && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, filter === f.kind && styles.chipLabelActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Onyesha walioidhinishwa tu"
            accessibilityState={{ checked: verifiedOnly }}
            onPress={() => setVerifiedOnly((current) => !current)}
            style={styles.verifiedToggle}
          >
            <View style={[styles.checkbox, verifiedOnly && styles.checkboxOn]}>
              {verifiedOnly ? <Text style={styles.checkmark}>OK</Text> : null}
            </View>
            <Text style={styles.verifiedLabel}>Walioidhinishwa na Borjie tu</Text>
          </Pressable>
        </Section>
        <Section title={`Matokeo (${visible.length})`}>
          {visible.length === 0 ? (
            <PlaceholderList items={[]} emptyLabel="Hakuna matangazo katika kichujio hiki" />
          ) : (
            <View style={styles.list}>
              {visible.map((l) => (
                <View key={l.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{l.title}</Text>
                    {l.verified ? <Text style={styles.badge}>Imeidhinishwa</Text> : null}
                  </View>
                  <Text style={styles.cardMeta}>
                    {l.location} · ukadiriaji {l.rating.toFixed(1)} / 5
                  </Text>
                  <Text style={styles.cardPrice}>
                    TZS {l.priceTzs.toLocaleString('en-US')} / {l.unit}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt
  },
  chipActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  chipLabelActive: {
    color: colors.earth900
  },
  verifiedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxOn: {
    backgroundColor: colors.success,
    borderColor: colors.success
  },
  checkmark: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  verifiedLabel: {
    color: colors.text,
    fontSize: fontSize.body
  },
  list: {
    gap: spacing.sm
  },
  card: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600',
    flex: 1
  },
  badge: {
    color: colors.textInverse,
    backgroundColor: colors.success,
    fontSize: fontSize.caption,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  cardPrice: {
    color: colors.goldDark,
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: spacing.sm
  }
})
