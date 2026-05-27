import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-06'

interface KpiTile {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly unit: string
  readonly delta: string
  readonly trend: 'up' | 'down' | 'flat'
}

interface SiteSummary {
  readonly id: string
  readonly siteName: string
  readonly attendance: number
  readonly loads: number
  readonly fuelLitres: number
  readonly headline: string
}

const SITES: ReadonlyArray<SiteSummary> = [
  { id: 's1', siteName: 'Geita', attendance: 24, loads: 18, fuelLitres: 220, headline: 'Lengo limefikiwa' },
  { id: 's2', siteName: 'Chunya', attendance: 19, loads: 14, fuelLitres: 180, headline: 'Excavator-2 imeharibika' },
  { id: 's3', siteName: 'Mwanza', attendance: 28, loads: 22, fuelLitres: 245, headline: 'Mizigo ya juu kuliko wastani' }
]

const KPIS: ReadonlyArray<KpiTile> = [
  { id: 'k1', label: 'Watu hudhuria', value: '71', unit: 'jumla', delta: '+5%', trend: 'up' },
  { id: 'k2', label: 'Mizigo', value: '54', unit: 'tani 108', delta: '+12%', trend: 'up' },
  { id: 'k3', label: 'Mafuta', value: '645', unit: 'L', delta: '-3%', trend: 'down' },
  { id: 'k4', label: 'Vizuizi', value: '2', unit: 'vya kazi', delta: '+1', trend: 'down' }
]

const BLOCKERS: ReadonlyArray<{ id: string; site: string; issue: string; eta: string }> = [
  { id: 'b1', site: 'Chunya', issue: 'Excavator-2 imeharibika · pampu', eta: 'Saa 8' },
  { id: 'b2', site: 'Geita', issue: 'Sampuli za assay zinasubiri lab', eta: 'Siku 1' }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <DailyReportView />
      </ScreenShell>
    </RoleGuard>
  )
}

function DailyReportView(): JSX.Element {
  const [focusSiteId, setFocusSiteId] = useState<string>(SITES[0]?.id ?? '')

  const focusedSite = useMemo<SiteSummary | undefined>(
    () => SITES.find((s) => s.id === focusSiteId),
    [focusSiteId]
  )

  const generatedAt = useMemo<string>(() => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }, [])

  return (
    <View>
      <Section title="Muhtasari wa siku" hint={`Imetolewa saa ${generatedAt} · soma chini ya sekunde 30`}>
        <View style={styles.kpiGrid}>
          {KPIS.map((kpi) => (
            <View key={kpi.id} style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>{kpi.label}</Text>
              <Text style={styles.kpiValue}>{kpi.value}</Text>
              <Text style={styles.kpiUnit}>{kpi.unit}</Text>
              <Text style={[styles.kpiDelta, trendStyle(kpi.trend)]}>
                {trendArrow(kpi.trend)} {kpi.delta}
              </Text>
            </View>
          ))}
        </View>
      </Section>
      <Section title="Migodi · bonyeza moja kuona zaidi">
        {SITES.map((site) => (
          <Pressable
            key={site.id}
            accessibilityRole="button"
            accessibilityLabel={`Mgodi wa ${site.siteName}`}
            onPress={() => setFocusSiteId(site.id)}
            style={({ pressed }) => [
              styles.siteRow,
              focusSiteId === site.id && styles.siteRowActive,
              pressed && styles.siteRowPressed
            ]}
          >
            <Text style={styles.siteName}>{site.siteName}</Text>
            <Text style={styles.siteHeadline}>{site.headline}</Text>
            <View style={styles.siteMeta}>
              <Text style={styles.siteMetaItem}>Watu {site.attendance}</Text>
              <Text style={styles.siteMetaItem}>Loads {site.loads}</Text>
              <Text style={styles.siteMetaItem}>Fuel {site.fuelLitres} L</Text>
            </View>
          </Pressable>
        ))}
      </Section>
      {focusedSite ? (
        <Section title={`Kina cha ${focusedSite.siteName}`} hint="Kati ya watu, mizigo na mafuta">
          <View style={styles.focus}>
            <FocusStat label="Watu wameingia" value={String(focusedSite.attendance)} suffix="kati ya 30" />
            <FocusStat label="Mizigo" value={String(focusedSite.loads)} suffix={`tani ${focusedSite.loads * 2}`} />
            <FocusStat label="Mafuta" value={`${focusedSite.fuelLitres} L`} suffix={`bei TZS ${focusedSite.fuelLitres * 3200}`} />
          </View>
        </Section>
      ) : null}
      <Section title="Vizuizi vya leo">
        {BLOCKERS.map((blocker) => (
          <View key={blocker.id} style={styles.blockerCard}>
            <Text style={styles.blockerSite}>{blocker.site}</Text>
            <Text style={styles.blockerIssue}>{blocker.issue}</Text>
            <Text style={styles.blockerEta}>Itamalizika: {blocker.eta}</Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

function FocusStat({ label, value, suffix }: { label: string; value: string; suffix: string }): JSX.Element {
  return (
    <View style={styles.focusStat}>
      <Text style={styles.focusLabel}>{label}</Text>
      <Text style={styles.focusValue}>{value}</Text>
      <Text style={styles.focusSuffix}>{suffix}</Text>
    </View>
  )
}

function trendArrow(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return '↑'
  if (trend === 'down') return '↓'
  return '·'
}

function trendStyle(trend: 'up' | 'down' | 'flat'): { color: string } {
  if (trend === 'up') return { color: colors.success }
  if (trend === 'down') return { color: colors.danger }
  return { color: colors.textMuted }
}

const styles = StyleSheet.create({
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  kpiTile: {
    width: '48%',
    backgroundColor: colors.earth700,
    padding: spacing.md,
    borderRadius: radius.md
  },
  kpiLabel: {
    color: colors.earth100,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  kpiValue: {
    color: colors.goldLight,
    fontSize: fontSize.h1,
    fontWeight: '800',
    marginTop: spacing.xs
  },
  kpiUnit: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  kpiDelta: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  siteRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border
  },
  siteRowActive: {
    borderColor: colors.gold,
    backgroundColor: colors.earth100
  },
  siteRowPressed: {
    opacity: 0.85
  },
  siteName: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  siteHeadline: {
    color: colors.earth700,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    fontStyle: 'italic'
  },
  siteMeta: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm
  },
  siteMetaItem: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  focus: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  focusStat: {
    flex: 1,
    backgroundColor: colors.gold,
    padding: spacing.md,
    borderRadius: radius.md
  },
  focusLabel: {
    color: colors.earth900,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  focusValue: {
    color: colors.earth900,
    fontSize: fontSize.h2,
    fontWeight: '800',
    marginTop: spacing.xs
  },
  focusSuffix: {
    color: colors.earth700,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  blockerCard: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.warn
  },
  blockerSite: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  blockerIssue: {
    color: colors.text,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  blockerEta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
