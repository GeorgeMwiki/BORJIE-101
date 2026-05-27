import { useCallback, useMemo } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-11'

const COPY = Object.freeze({
  loading: 'Inapakia kazi zinazosubiri…',
  summaryTitle: 'Muhtasari wa idhini',
  pendingChip: 'Subiri',
  approvedChip: 'Idhinisha',
  rejectedChip: 'Kataa',
  requestsTitle: 'Maombi yanayosubiri',
  approve: 'Idhinisha',
  reject: 'Kataa',
  kindLabels: Object.freeze({
    scheduled_service: 'Huduma iliyopangwa',
    repair: 'Matengenezo',
    inspection: 'Ukaguzi',
    breakdown: 'Hitilafu',
    overhaul: 'Marekebisho makubwa',
    tyre_change: 'Mabadiliko ya matairi',
    other: 'Nyingine'
  }),
  statusLabels: Object.freeze({
    open: 'Wazi',
    in_progress: 'Inaendelea',
    completed: 'Imekamilika',
    cancelled: 'Imefutwa'
  }),
  mutationErrorPrefix: 'Imeshindikana: '
})

type MaintenanceKind =
  | 'scheduled_service'
  | 'repair'
  | 'inspection'
  | 'breakdown'
  | 'overhaul'
  | 'tyre_change'
  | 'other'

type MaintenanceStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

interface MaintenanceEvent {
  readonly id: string
  readonly assetId: string
  readonly kind: MaintenanceKind
  readonly status: MaintenanceStatus
  readonly summary: string | null
  readonly costTzs: string | null
  readonly scheduledFor: string | null
  readonly createdAt: string
}

interface MaintenanceListResponse {
  readonly success: true
  readonly data: ReadonlyArray<MaintenanceEvent>
}

interface MaintenanceMutationVars {
  readonly event: MaintenanceEvent
  readonly nextStatus: MaintenanceStatus
}

const QUERY_KEY = ['mining', 'maintenance', 'open'] as const

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ScheduledApprovals />
      </ScreenShell>
    </RoleGuard>
  )
}

function ScheduledApprovals(): JSX.Element {
  const queryClient = useQueryClient()
  const query = useQuery<ReadonlyArray<MaintenanceEvent>, ApiError>({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<MaintenanceListResponse>('/maintenance/', {
        signal,
        query: { status: 'open' }
      })
      return response.data
    }
  })

  const mutation = useMutation<
    MaintenanceEvent,
    ApiError,
    MaintenanceMutationVars,
    { previous: ReadonlyArray<MaintenanceEvent> | undefined }
  >({
    mutationFn: async ({ event, nextStatus }) => {
      const response = await miningApi.post<{ success: true; data: MaintenanceEvent }>(
        '/maintenance/',
        {
          assetId: event.assetId,
          kind: event.kind,
          status: nextStatus,
          summary: event.summary ?? undefined,
          scheduledFor: event.scheduledFor ?? undefined
        }
      )
      return response.data
    },
    onMutate: async ({ event, nextStatus }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY })
      const previous = queryClient.getQueryData<ReadonlyArray<MaintenanceEvent>>(QUERY_KEY)
      if (previous) {
        const next: ReadonlyArray<MaintenanceEvent> = previous.map((row) =>
          row.id === event.id ? { ...row, status: nextStatus } : row
        )
        queryClient.setQueryData(QUERY_KEY, next)
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    }
  })

  const summary = useMemo(() => {
    const rows = query.data ?? []
    return {
      pending: rows.filter((row) => row.status === 'open').length,
      approved: rows.filter((row) => row.status === 'in_progress' || row.status === 'completed')
        .length,
      rejected: rows.filter((row) => row.status === 'cancelled').length
    }
  }, [query.data])

  const onApprove = useCallback(
    (event: MaintenanceEvent) => {
      mutation.mutate({ event, nextStatus: 'in_progress' })
    },
    [mutation]
  )

  const onReject = useCallback(
    (event: MaintenanceEvent) => {
      mutation.mutate({ event, nextStatus: 'cancelled' })
    },
    [mutation]
  )

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

  const rows = query.data ?? []
  if (rows.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  return (
    <View>
      {mutation.isError ? (
        <Text style={styles.toast} accessibilityRole="alert">
          {COPY.mutationErrorPrefix}
          {mutation.error?.message ?? 'unknown'}
        </Text>
      ) : null}
      <Section title={COPY.summaryTitle}>
        <View style={styles.metricRow}>
          <MetricChip label={COPY.pendingChip} value={summary.pending} tone="warn" />
          <MetricChip label={COPY.approvedChip} value={summary.approved} tone="success" />
          <MetricChip label={COPY.rejectedChip} value={summary.rejected} tone="danger" />
        </View>
      </Section>
      <Section title={COPY.requestsTitle}>
        {rows.map((event) => (
          <TaskCard
            key={event.id}
            event={event}
            disabled={mutation.isPending}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
      </Section>
    </View>
  )
}

interface TaskCardProps {
  event: MaintenanceEvent
  disabled: boolean
  onApprove: (event: MaintenanceEvent) => void
  onReject: (event: MaintenanceEvent) => void
}

function TaskCard({ event, disabled, onApprove, onReject }: TaskCardProps): JSX.Element {
  const isApproved = event.status === 'in_progress' || event.status === 'completed'
  const isRejected = event.status === 'cancelled'
  return (
    <View
      style={[
        styles.card,
        isApproved && styles.cardApproved,
        isRejected && styles.cardRejected
      ]}
    >
      <Text style={styles.cardTitle}>{event.summary ?? COPY.kindLabels[event.kind]}</Text>
      <Text style={styles.cardMeta}>
        {COPY.kindLabels[event.kind]} - {event.assetId}
      </Text>
      {event.costTzs ? (
        <Text style={styles.cardMeta}>TZS {event.costTzs}</Text>
      ) : null}
      <Text style={styles.cardPriority}>{COPY.statusLabels[event.status]}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${COPY.approve} ${event.id}`}
          disabled={disabled || event.status !== 'open'}
          onPress={() => onApprove(event)}
          style={[styles.btn, isApproved && styles.btnApprovedActive]}
        >
          <Text style={[styles.btnLabel, isApproved && styles.btnLabelActive]}>
            {COPY.approve}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${COPY.reject} ${event.id}`}
          disabled={disabled || event.status !== 'open'}
          onPress={() => onReject(event)}
          style={[styles.btn, styles.btnReject, isRejected && styles.btnRejectedActive]}
        >
          <Text style={[styles.btnLabel, isRejected && styles.btnLabelActive]}>{COPY.reject}</Text>
        </Pressable>
      </View>
    </View>
  )
}

interface MetricChipProps {
  label: string
  value: number
  tone: 'success' | 'warn' | 'danger'
}

function MetricChip({ label, value, tone }: MetricChipProps): JSX.Element {
  const toneColor = tone === 'success' ? colors.success : tone === 'warn' ? colors.warn : colors.danger
  return (
    <View style={[styles.metric, { borderColor: toneColor }]}>
      <Text style={[styles.metricValue, { color: toneColor }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  toast: {
    backgroundColor: colors.danger,
    color: colors.textInverse,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center'
  },
  metricValue: { fontSize: fontSize.h2, fontWeight: '800' },
  metricLabel: { color: colors.textMuted, fontSize: fontSize.caption, marginTop: spacing.xs },
  card: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1
  },
  cardApproved: { borderColor: colors.success, backgroundColor: '#EAF4EA' },
  cardRejected: { borderColor: colors.danger, backgroundColor: '#F4E5E6' },
  cardTitle: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  cardMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  cardPriority: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: spacing.xs
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center'
  },
  btnReject: {},
  btnApprovedActive: { backgroundColor: colors.success, borderColor: colors.success },
  btnRejectedActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnLabel: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  btnLabelActive: { color: colors.textInverse }
})
