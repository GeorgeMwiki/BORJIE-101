import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { miningApi } from '../../api/client'
import { PreviewBanner } from '../../components/PreviewBanner'
import { Section } from '../../components/Section'
import { useI18n } from '../../i18n/useI18n'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { pickCopy } from './copy'
import { classifyEndpointError, endpointPathFromError } from './missingApi'
import type { AlertSeverity, Incident, MaintenanceAlert } from './types'

/**
 * Band 2 — Live Exceptions. Linear-Triage swipe-list pattern (R3 §4):
 * single-tap row → action sheet. Severity uses a 3-tier max (red/amber/low)
 * per command-center research; never color-only — pairs with glyph + label.
 */

interface ExceptionStackProps {
  readonly siteId: string | null
}

interface IncidentsResponse {
  readonly items: ReadonlyArray<Incident>
}

interface MaintenanceResponse {
  readonly items: ReadonlyArray<MaintenanceAlert>
}

function useIncidents(siteId: string | null): UseQueryResult<IncidentsResponse, Error> {
  return useQuery<IncidentsResponse, Error>({
    queryKey: ['manager', 'incidents', siteId ?? 'auto'],
    queryFn: ({ signal }) =>
      miningApi.get<IncidentsResponse>('/incidents', {
        signal,
        query: {
          status: 'open',
          severity: 'high,medium',
          ...(siteId ? { siteId } : {})
        }
      }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false
  })
}

function useMaintenance(
  siteId: string | null
): UseQueryResult<MaintenanceResponse, Error> {
  return useQuery<MaintenanceResponse, Error>({
    queryKey: ['manager', 'maintenance', siteId ?? 'auto'],
    queryFn: ({ signal }) =>
      miningApi.get<MaintenanceResponse>('/maintenance', {
        signal,
        query: {
          healthStatus: 'warning,critical',
          ...(siteId ? { siteId } : {})
        }
      }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false
  })
}

export function ExceptionStack({ siteId }: ExceptionStackProps): JSX.Element {
  const { lang } = useI18n()
  const incidents = useIncidents(siteId)
  const maintenance = useMaintenance(siteId)
  const title = pickCopy(lang, 'bandExceptions')

  if (incidents.isLoading || maintenance.isLoading) {
    return (
      <Section title={title}>
        <ActivityIndicator color={colors.gold} accessibilityLabel={pickCopy(lang, 'loading')} />
      </Section>
    )
  }

  const incidentKind = incidents.isError ? classifyEndpointError(incidents.error) : null
  const maintenanceKind = maintenance.isError ? classifyEndpointError(maintenance.error) : null

  if (incidentKind === 'missing' || maintenanceKind === 'missing') {
    return (
      <Section title={title}>
        <PreviewBanner kind="env-missing" />
        {incidentKind === 'missing' ? (
          <Text style={styles.missingPath}>{endpointPathFromError(incidents.error)}</Text>
        ) : null}
        {maintenanceKind === 'missing' ? (
          <Text style={styles.missingPath}>{endpointPathFromError(maintenance.error)}</Text>
        ) : null}
      </Section>
    )
  }

  if (incidentKind === 'transient' || maintenanceKind === 'transient') {
    return (
      <Section title={title}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void incidents.refetch()
            void maintenance.refetch()
          }}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>{pickCopy(lang, 'errorRetry')}</Text>
        </Pressable>
      </Section>
    )
  }

  const incidentItems = incidents.data?.items ?? []
  const maintenanceItems = maintenance.data?.items ?? []
  const allEmpty = incidentItems.length === 0 && maintenanceItems.length === 0

  if (allEmpty) {
    return (
      <Section title={title}>
        <Text style={styles.empty}>{pickCopy(lang, 'emptyExceptions')}</Text>
      </Section>
    )
  }

  return (
    <Section title={title}>
      <View style={styles.stack}>
        {incidentItems.map((item) => (
          <IncidentRow key={item.id} item={item} />
        ))}
        {maintenanceItems.map((item) => (
          <MaintenanceRow key={item.id} item={item} />
        ))}
      </View>
    </Section>
  )
}

function IncidentRow({ item }: { readonly item: Incident }): JSX.Element {
  const { lang } = useI18n()
  const tone = severityTone(item.severity)
  const action = pickCopy(
    lang,
    item.actionLabel === 'escalate'
      ? 'actionEscalate'
      : item.actionLabel === 'reassign'
        ? 'actionReassign'
        : item.actionLabel === 'inspect'
          ? 'actionInspect'
          : 'actionCall'
  )
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} — ${action}`}
      style={[styles.row, { borderLeftColor: tone }]}
    >
      <View style={styles.rowBody}>
        <Text style={styles.severityGlyph} accessibilityElementsHidden>
          {severityGlyph(item.severity)}
        </Text>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowMeta}>{`${item.minutesOpen} min`}</Text>
        </View>
        <View style={[styles.chip, { borderColor: tone }]}>
          <Text style={[styles.chipText, { color: tone }]}>{action}</Text>
        </View>
      </View>
    </Pressable>
  )
}

function MaintenanceRow({ item }: { readonly item: MaintenanceAlert }): JSX.Element {
  const { lang } = useI18n()
  const tone = item.healthStatus === 'critical' ? colors.danger : colors.warn
  const action = pickCopy(lang, 'actionInspect')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.assetLabel} — ${action}`}
      style={[styles.row, { borderLeftColor: tone }]}
    >
      <View style={styles.rowBody}>
        <Text style={styles.severityGlyph} accessibilityElementsHidden>
          {item.healthStatus === 'critical' ? '!!' : '!'}
        </Text>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{item.assetLabel}</Text>
          <Text style={styles.rowMeta}>{item.note}</Text>
        </View>
        <View style={[styles.chip, { borderColor: tone }]}>
          <Text style={[styles.chipText, { color: tone }]}>{action}</Text>
        </View>
      </View>
    </Pressable>
  )
}

function severityTone(severity: AlertSeverity): string {
  if (severity === 'high') {
    return colors.danger
  }
  if (severity === 'med') {
    return colors.warn
  }
  return colors.earth500
}

function severityGlyph(severity: AlertSeverity): string {
  if (severity === 'high') {
    return '!!!'
  }
  if (severity === 'med') {
    return '!!'
  }
  return '!'
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: {
    minHeight: 56,
    borderLeftWidth: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { flex: 1 },
  severityGlyph: { fontSize: fontSize.body, fontWeight: '700', color: colors.danger, minWidth: 24 },
  rowTitle: { fontSize: fontSize.body, fontWeight: '600', color: colors.earth900 },
  rowMeta: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 32,
    justifyContent: 'center'
  },
  chipText: { fontSize: fontSize.caption, fontWeight: '600' },
  empty: { color: colors.textMuted, fontSize: fontSize.body },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  retryLabel: { color: colors.danger, fontSize: fontSize.body, fontWeight: '600' },
  missingPath: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: spacing.xs }
})
