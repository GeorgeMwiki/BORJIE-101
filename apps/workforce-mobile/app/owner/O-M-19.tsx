import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-19'

type ReportKind = 'all' | 'weekly' | 'monthly' | 'compliance'

interface Report {
  readonly id: string
  readonly title: string
  readonly kind: Exclude<ReportKind, 'all'>
  readonly issuedOn: string
  readonly sizeKb: number
  readonly approvedBy: string
}

const SEED_REPORTS: ReadonlyArray<Report> = [
  { id: 'r1', title: 'Ripoti ya wiki — 21 Mei 2026', kind: 'weekly', issuedOn: '21 Mei 2026', sizeKb: 184, approvedBy: 'Meneja Geita' },
  { id: 'r2', title: 'Ripoti ya wiki — 14 Mei 2026', kind: 'weekly', issuedOn: '14 Mei 2026', sizeKb: 176, approvedBy: 'Meneja Geita' },
  { id: 'r3', title: 'Ripoti ya mwezi — Aprili 2026', kind: 'monthly', issuedOn: '30 Apr 2026', sizeKb: 642, approvedBy: 'Mmiliki' },
  { id: 'r4', title: 'Ripoti ya mwezi — Machi 2026', kind: 'monthly', issuedOn: '31 Mar 2026', sizeKb: 598, approvedBy: 'Mmiliki' },
  { id: 'r5', title: 'Compliance TMAA Q1', kind: 'compliance', issuedOn: '15 Apr 2026', sizeKb: 1248, approvedBy: 'Wakili wa kampuni' },
  { id: 'r6', title: 'Compliance OSHA — usalama', kind: 'compliance', issuedOn: '03 Mei 2026', sizeKb: 312, approvedBy: 'Afisa Usalama' }
]

const FILTER_LABELS: ReadonlyArray<{ kind: ReportKind; label: string }> = [
  { kind: 'all', label: 'Zote' },
  { kind: 'weekly', label: 'Wiki' },
  { kind: 'monthly', label: 'Mwezi' },
  { kind: 'compliance', label: 'Compliance' }
]

export default function Screen(): JSX.Element {
  const [filter, setFilter] = useState<ReportKind>('all')
  const [lastShared, setLastShared] = useState<string | null>(null)

  const visible = useMemo<ReadonlyArray<Report>>(() => {
    if (filter === 'all') return SEED_REPORTS
    return SEED_REPORTS.filter((r) => r.kind === filter)
  }, [filter])

  const shareViaWhatsApp = (report: Report): void => {
    setLastShared(`${report.title} — imetumwa kwa WhatsApp`)
  }

  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Chuja kwa aina">
          <View style={styles.filterRow}>
            {FILTER_LABELS.map((f) => (
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
        </Section>
        <Section title={`Ripoti zilizoidhinishwa (${visible.length})`}>
          {visible.length === 0 ? (
            <PlaceholderList items={[]} emptyLabel="Hakuna ripoti katika kichujio hiki" />
          ) : (
            <View style={styles.reportList}>
              {visible.map((r) => (
                <View key={r.id} style={styles.reportCard}>
                  <Text style={styles.reportTitle}>{r.title}</Text>
                  <Text style={styles.reportMeta}>
                    {r.issuedOn} · {r.sizeKb} KB · idhinishwa na {r.approvedBy}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Shiriki ${r.title} kwa WhatsApp`}
                    onPress={() => shareViaWhatsApp(r)}
                    style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}
                  >
                    <Text style={styles.shareLabel}>Shiriki kwa WhatsApp</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </Section>
        {lastShared ? (
          <Section title="Tukio la mwisho">
            <Text style={styles.toast}>{lastShared}</Text>
          </Section>
        ) : null}
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
  reportList: {
    gap: spacing.sm
  },
  reportCard: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md
  },
  reportTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  reportMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  shareButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    backgroundColor: colors.success,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill
  },
  shareButtonPressed: {
    opacity: 0.85
  },
  shareLabel: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  toast: {
    color: colors.success,
    fontSize: fontSize.body,
    fontWeight: '600'
  }
})
