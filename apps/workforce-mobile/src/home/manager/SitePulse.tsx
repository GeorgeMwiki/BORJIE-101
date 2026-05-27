import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { miningApi } from '../../api/client'
import { PreviewBanner } from '../../components/PreviewBanner'
import { useI18n } from '../../i18n/useI18n'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { Section } from '../../components/Section'
import { COPY, pickCopy, pickSafetyLabel } from './copy'
import { classifyEndpointError, endpointPathFromError } from './missingApi'
import type { SitePulseData } from './types'

/**
 * Band 1 — Site Pulse. Five KPI tiles per research §1 (max 5 to avoid
 * visual-noise normalization). Each tile pairs color + label + icon glyph
 * so a11y holds without color-only signal.
 */

interface SitePulseProps {
  readonly siteId: string | null
}

function fetchSitePulse(
  siteId: string | null,
  signal: AbortSignal
): Promise<SitePulseData> {
  return miningApi.get<SitePulseData>('/cockpit', {
    signal,
    ...(siteId ? { query: { siteId } } : {})
  })
}

function usePulse(siteId: string | null): UseQueryResult<SitePulseData, Error> {
  return useQuery<SitePulseData, Error>({
    queryKey: ['manager', 'site-pulse', siteId ?? 'auto'],
    queryFn: ({ signal }) => fetchSitePulse(siteId, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false
  })
}

export function SitePulse({ siteId }: SitePulseProps): JSX.Element {
  const { lang } = useI18n()
  const query = usePulse(siteId)
  const title = pickCopy(lang, 'bandSitePulse')

  if (query.isLoading) {
    return (
      <Section title={title}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} />
          <Text style={styles.loadingLabel}>{pickCopy(lang, 'loading')}</Text>
        </View>
      </Section>
    )
  }

  if (query.isError) {
    const kind = classifyEndpointError(query.error)
    if (kind === 'missing') {
      return (
        <Section title={title}>
          <PreviewBanner kind="env-missing" />
          <Text style={styles.missingPath}>{endpointPathFromError(query.error)}</Text>
        </Section>
      )
    }
    return (
      <Section title={title}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pickCopy(lang, 'errorRetry')}
          onPress={() => {
            void query.refetch()
          }}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>{pickCopy(lang, 'errorRetry')}</Text>
        </Pressable>
      </Section>
    )
  }

  const data = query.data
  if (!data) {
    return (
      <Section title={title}>
        <PreviewBanner kind="no-data" />
      </Section>
    )
  }

  return (
    <Section title={title} hint={`${data.siteName} — ${data.shiftLabel}`}>
      <View style={styles.tiles}>
        <KpiTile
          label={pickCopy(lang, 'kpiPlan')}
          value={`${data.planAttainmentPct}%`}
          tone={toneFromPct(data.planAttainmentPct, 90, 70)}
          glyph="P"
        />
        <KpiTile
          label={pickCopy(lang, 'kpiCrew')}
          value={`${data.crewOnShift}/${data.crewExpected}`}
          tone={toneFromRatio(data.crewOnShift, data.crewExpected)}
          glyph="C"
        />
        <KpiTile
          label={pickCopy(lang, 'kpiEquipment')}
          value={`${data.equipmentAvailabilityPct}%`}
          tone={toneFromPct(data.equipmentAvailabilityPct, 85, 70)}
          glyph="E"
        />
        <KpiTile
          label={pickCopy(lang, 'kpiAlerts')}
          value={String(data.alertsCount)}
          tone={data.alertsCount === 0 ? 'green' : data.alertsCount < 3 ? 'amber' : 'red'}
          glyph="!"
        />
        <KpiTile
          label={pickCopy(lang, 'kpiSafety')}
          value={pickSafetyLabel(lang, data.safetyStatus)}
          tone={data.safetyStatus}
          glyph="S"
        />
      </View>
    </Section>
  )
}

interface KpiTileProps {
  readonly label: string
  readonly value: string
  readonly tone: 'green' | 'amber' | 'red'
  readonly glyph: string
}

function KpiTile({ label, value, tone, glyph }: KpiTileProps): JSX.Element {
  const toneColor = tone === 'green' ? colors.success : tone === 'amber' ? colors.warn : colors.danger
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${label} ${value}`}
      style={[styles.tile, { borderColor: toneColor }]}
    >
      <Text style={[styles.glyph, { color: toneColor }]} accessibilityElementsHidden>
        {glyph}
      </Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

function toneFromPct(value: number, green: number, amber: number): 'green' | 'amber' | 'red' {
  if (value >= green) {
    return 'green'
  }
  if (value >= amber) {
    return 'amber'
  }
  return 'red'
}

function toneFromRatio(actual: number, expected: number): 'green' | 'amber' | 'red' {
  if (expected <= 0) {
    return 'amber'
  }
  return toneFromPct((actual / expected) * 100, 90, 75)
}

// COPY referenced indirectly via pickCopy; keep export to anchor the catalogue.
export const SITE_PULSE_COPY_KEYS = Object.keys(COPY)

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    minWidth: 96,
    minHeight: 64,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center'
  },
  glyph: { fontSize: fontSize.caption, fontWeight: '700' },
  value: { fontSize: fontSize.h3, fontWeight: '700', color: colors.earth900 },
  label: { fontSize: fontSize.caption, color: colors.textMuted },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  loadingLabel: { color: colors.textMuted, fontSize: fontSize.body },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  retryLabel: { color: colors.danger, fontSize: fontSize.body, fontWeight: '600' },
  missingPath: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: spacing.xs }
})
