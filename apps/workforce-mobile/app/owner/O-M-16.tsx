import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-16'

interface Commitment {
  readonly id: string
  readonly title: string
  readonly village: string
  readonly status: 'fulfilled' | 'in_progress' | 'overdue'
  readonly amountTzs: number
}

interface Grievance {
  readonly id: string
  readonly issue: string
  readonly location: string
  readonly openDays: number
  readonly resolved: boolean
}

const SEED_COMMITMENTS: ReadonlyArray<Commitment> = [
  { id: 'cm1', title: 'Borehole #3 — maji safi', village: 'Nyamongo', status: 'fulfilled', amountTzs: 18_500_000 },
  { id: 'cm2', title: 'Madawati ya shule', village: 'Geita Kati', status: 'fulfilled', amountTzs: 6_200_000 },
  { id: 'cm3', title: 'Barabara ya kijiji', village: 'Buzwagi', status: 'in_progress', amountTzs: 42_000_000 },
  { id: 'cm4', title: 'Zahanati — vifaa', village: 'Chunya', status: 'in_progress', amountTzs: 12_750_000 },
  { id: 'cm5', title: 'Mafunzo ya vijana', village: 'Mbeya', status: 'overdue', amountTzs: 8_400_000 }
]

const SEED_GRIEVANCES: ReadonlyArray<Grievance> = [
  { id: 'g1', issue: 'Vumbi la lori usiku', location: 'Kijiji A · njia kuu', openDays: 5, resolved: false },
  { id: 'g2', issue: 'Maji yenye uchafu', location: 'Borehole 3', openDays: 0, resolved: true },
  { id: 'g3', issue: 'Kelele za jenereta', location: 'Karibu na shule', openDays: 12, resolved: false }
]

export default function Screen(): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'open'>('all')

  const fulfilledPct = useMemo<number>(() => {
    const done = SEED_COMMITMENTS.filter((c) => c.status === 'fulfilled').length
    return Math.round((done / SEED_COMMITMENTS.length) * 100)
  }, [])

  const grievances = useMemo(() => {
    if (filter === 'open') return SEED_GRIEVANCES.filter((g) => !g.resolved)
    return SEED_GRIEVANCES
  }, [filter])

  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Ahadi za jamii — utekelezaji">
          <BigNumber
            value={`${fulfilledPct}%`}
            label="Ahadi zilizotekelezwa"
            caption={`${SEED_COMMITMENTS.length} ahadi · TZS milioni 87.85`}
          />
        </Section>
        <Section title="Orodha ya ahadi">
          <PlaceholderList
            items={SEED_COMMITMENTS.map((c) => ({
              id: c.id,
              primary: `${c.title} · ${c.village}`,
              secondary: `${labelStatus(c.status)} · TZS ${formatTzs(c.amountTzs)}`
            }))}
          />
        </Section>
        <Section title="Malalamiko ya jamii">
          <View style={styles.toggleRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Onyesha yote"
              onPress={() => setFilter('all')}
              style={[styles.toggle, filter === 'all' && styles.toggleActive]}
            >
              <Text style={[styles.toggleLabel, filter === 'all' && styles.toggleLabelActive]}>Yote</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Onyesha wazi tu"
              onPress={() => setFilter('open')}
              style={[styles.toggle, filter === 'open' && styles.toggleActive]}
            >
              <Text style={[styles.toggleLabel, filter === 'open' && styles.toggleLabelActive]}>Wazi</Text>
            </Pressable>
          </View>
          <PlaceholderList
            items={grievances.map((g) => ({
              id: g.id,
              primary: `${g.issue} · ${g.location}`,
              secondary: g.resolved ? 'Imefungwa' : `Wazi · siku ${g.openDays}`
            }))}
            emptyLabel="Hakuna malalamiko wazi"
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

function labelStatus(status: Commitment['status']): string {
  if (status === 'fulfilled') return 'Imetekelezwa'
  if (status === 'in_progress') return 'Inaendelea'
  return 'Imechelewa'
}

function formatTzs(amount: number): string {
  return amount.toLocaleString('en-US')
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  toggle: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt
  },
  toggleActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  toggleLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  toggleLabelActive: {
    color: colors.earth900
  }
})
