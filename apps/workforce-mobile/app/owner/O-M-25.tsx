import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-25'

type PackageStatus = 'ready' | 'generating' | 'expired'

interface AuditPackage {
  readonly id: string
  readonly quarter: string
  readonly periodLabel: string
  readonly generatedAtISO: string
  readonly sizeMb: number
  readonly pages: number
  readonly status: PackageStatus
  readonly regulator: string
}

const SEED_PACKAGES: ReadonlyArray<AuditPackage> = [
  {
    id: 'pkg-2026-q1',
    quarter: 'Q1 2026',
    periodLabel: 'Jan - Mar 2026',
    generatedAtISO: '2026-04-12T08:00:00Z',
    sizeMb: 18.4,
    pages: 142,
    status: 'ready',
    regulator: 'TMAA + TRA'
  },
  {
    id: 'pkg-2025-q4',
    quarter: 'Q4 2025',
    periodLabel: 'Okt - Des 2025',
    generatedAtISO: '2026-01-15T08:00:00Z',
    sizeMb: 22.1,
    pages: 168,
    status: 'ready',
    regulator: 'TMAA + TRA + NEMC'
  },
  {
    id: 'pkg-2025-q3',
    quarter: 'Q3 2025',
    periodLabel: 'Jul - Sep 2025',
    generatedAtISO: '2025-10-08T08:00:00Z',
    sizeMb: 19.7,
    pages: 151,
    status: 'expired',
    regulator: 'TMAA'
  }
]

const INCLUDED_SECTIONS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 's1', label: 'Maamuzi yote ya AI (na evidence chain)' },
  { id: 's2', label: 'Hati za PML na leseni za migodi' },
  { id: 's3', label: 'Ripoti za shifti na mahudhurio' },
  { id: 's4', label: 'Ledger ya double-entry (TZS-primary)' },
  { id: 's5', label: 'Matukio ya safety na NEMC reports' }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <AuditPackages />
      </ScreenShell>
    </RoleGuard>
  )
}

function AuditPackages(): JSX.Element {
  const [packages, setPackages] = useState<ReadonlyArray<AuditPackage>>(SEED_PACKAGES)
  const [exportedId, setExportedId] = useState<string | null>(null)
  const [newQueued, setNewQueued] = useState<boolean>(false)

  const exportPackage = useCallback((id: string): void => {
    setExportedId(id)
  }, [])

  const generateNew = useCallback((): void => {
    const next: AuditPackage = {
      id: `pkg-2026-q2`,
      quarter: 'Q2 2026',
      periodLabel: 'Apr - Jun 2026',
      generatedAtISO: new Date().toISOString(),
      sizeMb: 0,
      pages: 0,
      status: 'generating',
      regulator: 'TMAA + TRA'
    }
    setPackages([next, ...packages.filter((row) => row.id !== next.id)])
    setNewQueued(true)
  }, [packages])

  const totalSizeMb = useMemo<number>(
    () => packages.reduce<number>((sum, row) => sum + row.sizeMb, 0),
    [packages]
  )

  return (
    <View>
      <Section title="Muhtasari" hint={`Pakeji ${packages.length} · jumla ${totalSizeMb.toFixed(1)} MB`}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Pakeji ya Ukaguzi - Q2 2026</Text>
          <Text style={styles.summaryLine}>Tarehe ya mwisho: 15 Julai 2026</Text>
          <Text style={styles.summaryLine}>Mdhibiti: TMAA + TRA</Text>
        </View>
        <Button
          label={newQueued ? 'Inazalishwa kwenye foleni…' : 'Anzisha Pakeji Mpya'}
          onPress={generateNew}
          disabled={newQueued}
        />
      </Section>

      <Section title="Vifaa vinavyojumuishwa" hint="Ushahidi kamili kwa mdhibiti">
        {INCLUDED_SECTIONS.map((row) => (
          <View key={row.id} style={styles.itemRow}>
            <View style={styles.dot} />
            <Text style={styles.itemText}>{row.label}</Text>
          </View>
        ))}
      </Section>

      <Section title="Historia ya pakeji" hint="Bonyeza ili kuhamisha PDF">
        {packages.map((pkg) => (
          <View key={pkg.id} style={styles.packageRow}>
            <View style={styles.packageHead}>
              <Text style={styles.packageQuarter}>{pkg.quarter}</Text>
              <View style={[styles.statusPill, statusPillStyle(pkg.status)]}>
                <Text style={styles.statusPillText}>{statusLabel(pkg.status)}</Text>
              </View>
            </View>
            <Text style={styles.packageMeta}>{pkg.periodLabel}</Text>
            <Text style={styles.packageMeta}>
              {pkg.sizeMb > 0 ? `${pkg.sizeMb.toFixed(1)} MB · kurasa ${pkg.pages}` : 'Inakokotoa…'}
            </Text>
            <Text style={styles.packageMeta}>Mdhibiti: {pkg.regulator}</Text>
            <Text style={styles.packageMeta}>Imezalishwa {formatDate(pkg.generatedAtISO)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Hamisha ${pkg.quarter}`}
              onPress={() => exportPackage(pkg.id)}
              disabled={pkg.status !== 'ready'}
              style={({ pressed }) => [
                styles.exportBtn,
                pkg.status !== 'ready' ? styles.exportBtnDisabled : null,
                pressed && pkg.status === 'ready' ? styles.exportBtnPressed : null
              ]}
            >
              <Text style={styles.exportBtnText}>
                {pkg.status === 'ready' ? 'Hamisha PDF' : 'Haipatikani'}
              </Text>
            </Pressable>
          </View>
        ))}
      </Section>

      <Section title="Saini ya kuondoa pakeji" hint="Idhinisha kwa kidole">
        <FingerprintPlaceholder label="Idhinisha kupakua" />
        {exportedId ? (
          <Text style={styles.exportedNote}>
            Pakeji {exportedId} imepelekwa kwenye foleni ya export
          </Text>
        ) : null}
      </Section>
    </View>
  )
}

function statusLabel(status: PackageStatus): string {
  if (status === 'ready') return 'Tayari'
  if (status === 'generating') return 'Inazalishwa'
  return 'Imepitwa na wakati'
}

function statusPillStyle(status: PackageStatus): { backgroundColor: string } {
  if (status === 'ready') return { backgroundColor: colors.success }
  if (status === 'generating') return { backgroundColor: colors.warn }
  return { backgroundColor: colors.earth300 }
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const styles = StyleSheet.create({
  summaryCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  summaryTitle: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  summaryLine: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
    marginRight: spacing.md
  },
  itemText: {
    color: colors.text,
    fontSize: fontSize.body,
    flex: 1
  },
  packageRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  packageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm
  },
  packageQuarter: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill
  },
  statusPillText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  packageMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  exportBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.gold,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  exportBtnDisabled: {
    backgroundColor: colors.border
  },
  exportBtnPressed: {
    backgroundColor: colors.goldDark
  },
  exportBtnText: {
    color: colors.earth900,
    fontWeight: '700',
    fontSize: fontSize.body
  },
  exportedNote: {
    color: colors.success,
    fontSize: fontSize.caption,
    marginTop: spacing.sm
  }
})
