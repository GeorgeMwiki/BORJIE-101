import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQueries } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-06'

const COPY = Object.freeze({
  loading: 'Inakusanya muhtasari wa siku…',
  errorInline: 'Imeshindwa kupakua muhtasari wa siku.',
  emptyHint: 'Hakuna shifti za siku ya leo bado.',
  sectionSummary: 'Muhtasari wa siku',
  sectionSummaryHint: 'Vipande vya KPI kutoka kwa daily-brief + production',
  sectionSites: 'Migodi · bonyeza moja kuona zaidi',
  sectionFocus: 'Kina cha mgodi',
  sectionFocusHint: 'Mizigo, mafuta na shifti za siku 30',
  sectionBlockers: 'Vizuizi vya leo',
  kpiAttendance: 'Shifti za leo',
  kpiAttendanceUnit: 'mlolongo',
  kpiTonnage: 'Mizigo (30d)',
  kpiTonnageUnitPrefix: 'tani',
  kpiFuel: 'Mafuta (30d)',
  kpiFuelUnit: 'L',
  kpiBlockers: 'Vizuizi vya wazi',
  kpiBlockersUnit: 'incidents + grievances',
  blockerIncidentsLabel: 'Incidents zilizo wazi',
  blockerGrievancesLabel: 'Grievances zilizo wazi',
  blockerCriticalLabel: 'Critical / High'
})

interface DailyBrief {
  readonly date: string
  readonly shiftsToday: number
  readonly openIncidents: number
  readonly openGrievances: number
  readonly criticalIncidents: number
}

interface ProductionRow {
  readonly siteId: string
  readonly tonnes: number
  readonly fuel: number
  readonly shifts: number
}

interface ProductionData {
  readonly window: '30d'
  readonly perSite: ReadonlyArray<ProductionRow>
}

interface ApiEnvelope<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: { code?: string; message?: string }
}

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
  const [briefQuery, productionQuery] = useQueries({
    queries: [
      {
        queryKey: ['mining', 'cockpit', 'daily-brief'],
        queryFn: async (ctx: { signal?: AbortSignal }) => {
          const envelope = await miningApi.get<ApiEnvelope<DailyBrief>>(
            '/cockpit/daily-brief',
            ctx.signal ? { signal: ctx.signal } : {}
          )
          if (!envelope.success || !envelope.data) {
            throw new Error(envelope.error?.message ?? COPY.errorInline)
          }
          return envelope.data
        }
      },
      {
        queryKey: ['mining', 'cockpit', 'production-vs-target'],
        queryFn: async (ctx: { signal?: AbortSignal }) => {
          const envelope = await miningApi.get<ApiEnvelope<ProductionData>>(
            '/cockpit/production-vs-target',
            ctx.signal ? { signal: ctx.signal } : {}
          )
          if (!envelope.success || !envelope.data) {
            throw new Error(envelope.error?.message ?? COPY.errorInline)
          }
          return envelope.data
        }
      }
    ]
  })

  const [focusSiteId, setFocusSiteId] = useState<string>('')

  const sites = useMemo<ReadonlyArray<ProductionRow>>(
    () => productionQuery.data?.perSite ?? [],
    [productionQuery.data]
  )

  const totals = useMemo(() => {
    const tonnes = sites.reduce((sum, row) => sum + Number(row.tonnes || 0), 0)
    const fuel = sites.reduce((sum, row) => sum + Number(row.fuel || 0), 0)
    return { tonnes, fuel }
  }, [sites])

  const focusedSite = useMemo<ProductionRow | undefined>(() => {
    if (sites.length === 0) return undefined
    return sites.find((s) => s.siteId === focusSiteId) ?? sites[0]
  }, [focusSiteId, sites])

  const isPending = briefQuery.isPending || productionQuery.isPending
  const isError = briefQuery.isError || productionQuery.isError
  const composedError = briefQuery.error ?? productionQuery.error

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (isError) {
    return (
      <View>
        {isBackendUnavailable(composedError) ? (
          <PreviewBanner kind="env-missing" />
        ) : (
          <Text style={styles.errorInline}>{COPY.errorInline}</Text>
        )}
      </View>
    )
  }

  const brief = briefQuery.data
  if (!brief || (sites.length === 0 && brief.shiftsToday === 0)) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
        <Text style={styles.emptyHint}>{COPY.emptyHint}</Text>
      </View>
    )
  }

  const openBlockers = brief.openIncidents + brief.openGrievances

  return (
    <View>
      <Section title={COPY.sectionSummary} hint={`${COPY.sectionSummaryHint} · ${brief.date}`}>
        <View style={styles.kpiGrid}>
          <KpiTile
            label={COPY.kpiAttendance}
            value={String(brief.shiftsToday)}
            unit={COPY.kpiAttendanceUnit}
          />
          <KpiTile
            label={COPY.kpiTonnage}
            value={formatNumber(totals.tonnes)}
            unit={`${COPY.kpiTonnageUnitPrefix} ${formatNumber(totals.tonnes)}`}
          />
          <KpiTile
            label={COPY.kpiFuel}
            value={formatNumber(totals.fuel)}
            unit={COPY.kpiFuelUnit}
          />
          <KpiTile
            label={COPY.kpiBlockers}
            value={String(openBlockers)}
            unit={COPY.kpiBlockersUnit}
            danger={brief.criticalIncidents > 0}
          />
        </View>
      </Section>
      {sites.length > 0 ? (
        <Section title={COPY.sectionSites}>
          {sites.map((site) => (
            <Pressable
              key={site.siteId}
              accessibilityRole="button"
              accessibilityLabel={`Mgodi ${site.siteId}`}
              onPress={() => setFocusSiteId(site.siteId)}
              style={({ pressed }) => [
                styles.siteRow,
                (focusedSite?.siteId ?? '') === site.siteId && styles.siteRowActive,
                pressed && styles.siteRowPressed
              ]}
            >
              <Text style={styles.siteName}>{site.siteId}</Text>
              <View style={styles.siteMeta}>
                <Text style={styles.siteMetaItem}>Shifti {site.shifts}</Text>
                <Text style={styles.siteMetaItem}>Tani {formatNumber(site.tonnes)}</Text>
                <Text style={styles.siteMetaItem}>Fuel {formatNumber(site.fuel)} L</Text>
              </View>
            </Pressable>
          ))}
        </Section>
      ) : null}
      {focusedSite ? (
        <Section title={COPY.sectionFocus} hint={COPY.sectionFocusHint}>
          <View style={styles.focus}>
            <FocusStat label="Shifti" value={String(focusedSite.shifts)} suffix="siku 30" />
            <FocusStat
              label="Mizigo"
              value={formatNumber(focusedSite.tonnes)}
              suffix={`tani ${formatNumber(focusedSite.tonnes)}`}
            />
            <FocusStat
              label="Mafuta"
              value={`${formatNumber(focusedSite.fuel)} L`}
              suffix="jumla siku 30"
            />
          </View>
        </Section>
      ) : null}
      <Section title={COPY.sectionBlockers}>
        <BlockerRow
          label={COPY.blockerIncidentsLabel}
          value={String(brief.openIncidents)}
          accent="warn"
        />
        <BlockerRow
          label={COPY.blockerGrievancesLabel}
          value={String(brief.openGrievances)}
          accent="warn"
        />
        <BlockerRow
          label={COPY.blockerCriticalLabel}
          value={String(brief.criticalIncidents)}
          accent="danger"
        />
      </Section>
    </View>
  )
}

function KpiTile({
  label,
  value,
  unit,
  danger
}: {
  label: string
  value: string
  unit: string
  danger?: boolean
}): JSX.Element {
  return (
    <View style={[styles.kpiTile, danger ? styles.kpiTileDanger : null]}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiUnit}>{unit}</Text>
    </View>
  )
}

function FocusStat({
  label,
  value,
  suffix
}: {
  label: string
  value: string
  suffix: string
}): JSX.Element {
  return (
    <View style={styles.focusStat}>
      <Text style={styles.focusLabel}>{label}</Text>
      <Text style={styles.focusValue}>{value}</Text>
      <Text style={styles.focusSuffix}>{suffix}</Text>
    </View>
  )
}

function BlockerRow({
  label,
  value,
  accent
}: {
  label: string
  value: string
  accent: 'warn' | 'danger'
}): JSX.Element {
  const borderColor = accent === 'danger' ? colors.danger : colors.warn
  return (
    <View style={[styles.blockerCard, { borderLeftColor: borderColor }]}>
      <Text style={styles.blockerSite}>{label}</Text>
      <Text style={styles.blockerIssue}>{value}</Text>
    </View>
  )
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`
  }
  return value % 1 === 0 ? String(value) : value.toFixed(1)
}

function isBackendUnavailable(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (error instanceof ApiError) return error.status >= 500 || error.status === 503
  return false
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    paddingVertical: spacing.xl
  },
  loadingLabel: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  errorInline: {
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginVertical: spacing.md
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
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
  kpiTileDanger: {
    backgroundColor: colors.danger
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
    borderLeftWidth: 4
  },
  blockerSite: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  blockerIssue: {
    color: colors.text,
    fontSize: fontSize.lead,
    marginTop: spacing.xs,
    fontWeight: '700'
  }
})
