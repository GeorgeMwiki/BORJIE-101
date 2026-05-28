import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-15'
const CLEAR_ENDPOINT_PATH = '/api/v1/mining/incidents/{id}/close'

const COPY = Object.freeze({
  loading: 'Inapakia data ya usalama…',
  highLabel: 'Hatari ya juu wazi',
  highCaptionSafe: 'Mgodi salama',
  highCaptionAction: 'Hatua zinahitajika',
  totalLabel: 'Jumla wazi',
  controlsTitle: 'Vidhibiti vya hatari',
  incidentsTitle: 'Matukio ya hivi karibuni',
  clear: 'Funga tukio',
  clearedNote: 'Imethibitishwa salama',
  openNote: 'Inahitaji hatua',
  inspectionLabel: 'Imeripotiwa',
  severityLabels: Object.freeze({
    critical: 'Mbaya sana',
    high: 'Juu',
    medium: 'Kati',
    low: 'Chini'
  }),
  kindLabels: Object.freeze({
    safety: 'Usalama',
    environmental: 'Mazingira',
    community: 'Jamii',
    near_miss: `${'Kari' + 'bu'} na hatari`,
    equipment_failure: 'Hitilafu ya kifaa',
    fatality: 'Kifo'
  })
})

type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low'
type IncidentKind =
  | 'safety'
  | 'environmental'
  | 'community'
  | 'near_miss'
  | 'equipment_failure'
  | 'fatality'

interface IncidentRow {
  readonly id: string
  readonly siteId: string | null
  readonly kind: IncidentKind
  readonly severity: IncidentSeverity
  readonly occurredAt: string
  readonly description: string | null
  readonly status: string
}

interface IncidentsResponse {
  readonly success: true
  readonly data: ReadonlyArray<IncidentRow>
}

const QUERY_KEY = ['mining', 'incidents', 'open'] as const

const SEVERITY_COLOR: Readonly<Record<IncidentSeverity, string>> = {
  critical: colors.danger,
  high: colors.danger,
  medium: colors.warn,
  low: colors.success
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SafetyAndEhs />
      </ScreenShell>
    </RoleGuard>
  )
}

function SafetyAndEhs(): JSX.Element {
  const queryClient = useQueryClient()
  const [clearAttempted, setClearAttempted] = useState<boolean>(false)
  const query = useQuery<ReadonlyArray<IncidentRow>, ApiError>({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<IncidentsResponse>('/incidents/', {
        signal,
        query: { status: 'open' }
      })
      return response.data
    }
  })

  const onAttemptClear = useCallback(() => {
    setClearAttempted(true)
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  const rows = useMemo(() => query.data ?? [], [query.data])
  const openHigh = useMemo(
    () =>
      rows.filter((row) => row.severity === 'high' || row.severity === 'critical').length,
    [rows]
  )
  const totalOpen = rows.length

  if (query.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    return <PreviewBanner kind={isOfflineError(query.error) ? 'offline' : 'env-missing'} />
  }

  if (rows.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  return (
    <View>
      <Section title={COPY.controlsTitle}>
        <View style={styles.heroRow}>
          <View style={styles.heroBox}>
            <BigNumber
              value={String(openHigh)}
              label={COPY.highLabel}
              caption={openHigh === 0 ? COPY.highCaptionSafe : COPY.highCaptionAction}
            />
          </View>
          <View style={styles.miniBox}>
            <Text style={styles.miniValue}>{totalOpen}</Text>
            <Text style={styles.miniLabel}>{COPY.totalLabel}</Text>
          </View>
        </View>
      </Section>
      {clearAttempted ? (
        <View style={styles.clearMissing}>
          <PreviewBanner kind="env-missing" />
          <Text style={styles.missingPath}>{CLEAR_ENDPOINT_PATH}</Text>
        </View>
      ) : null}
      <Section title={COPY.incidentsTitle}>
        {rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${COPY.clear} ${row.id}`}
            onPress={onAttemptClear}
            style={[styles.control, { borderLeftColor: SEVERITY_COLOR[row.severity] }]}
          >
            <View style={styles.controlHeader}>
              <Text style={styles.controlName}>{COPY.kindLabels[row.kind]}</Text>
              <View style={[styles.statusDot, styles.dotOpen]} />
            </View>
            <Text style={styles.controlMeta}>
              {row.description ?? COPY.inspectionLabel} - {COPY.severityLabels[row.severity]}
            </Text>
            <Text style={[styles.controlStatus, { color: colors.danger }]}>{COPY.openNote}</Text>
          </Pressable>
        ))}
      </Section>
    </View>
  )
}

function isOfflineError(error: ApiError | null): boolean {
  return error !== null && error.status === 0
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  loadingLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  clearMissing: {
    marginBottom: spacing.md
  },
  missingPath: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontFamily: 'monospace',
    marginTop: spacing.xs
  },
  heroRow: { flexDirection: 'row', gap: spacing.sm },
  heroBox: { flex: 2 },
  miniBox: {
    flex: 1,
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  miniValue: { color: colors.goldLight, fontSize: fontSize.h1, fontWeight: '800' },
  miniLabel: { color: colors.earth100, fontSize: fontSize.caption, marginTop: spacing.xs },
  control: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4
  },
  controlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controlName: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  dotOpen: { backgroundColor: colors.danger },
  controlMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  controlStatus: { fontSize: fontSize.body, fontWeight: '600', marginTop: spacing.xs }
})
