import { useCallback } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-03'
const MISSING_ENDPOINT = '/api/v1/mining/cockpit/decisions'

const COPY = Object.freeze({
  loading: 'Inapakia maamuzi…',
  emptyTitle: 'Hakuna maamuzi yanayosubiri',
  pendingHint: (count: number, total: number): string =>
    `Yamebaki ${count} kati ya ${total}`,
  riskHigh: 'Hatari kubwa',
  riskMed: 'Hatari ya kati',
  riskLow: 'Hatari ndogo',
  reasonsToggle: 'Bonyeza kuona sababu',
  statusPending: 'Bado inasubiri',
  statusApproved: 'Imeidhinishwa',
  statusRejected: 'Imekataliwa',
  approve: 'Idhinisha',
  reject: 'Kataa',
  fingerprintTitle: 'Saini ya kidole',
  fingerprintHint: 'Thibitisha maamuzi yote kwa biometrics',
  fingerprintLabel: 'Saini hapa kumaliza',
  sectionTitle: 'Maamuzi yanayosubiri',
  mutationErrorPrefix: 'Imeshindikana: ',
  rejectReason: 'Imekataliwa kupitia kifaa cha mkononi cha mmiliki'
})

type DecisionStatus = 'pending' | 'approved' | 'rejected'
type RiskLevel = 'low' | 'med' | 'high'

interface DecisionRow {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly riskLevel: RiskLevel
  readonly status: DecisionStatus
  readonly evidence: ReadonlyArray<string>
  readonly createdAt: string
}

// The gateway GET /cockpit/decisions returns the raw mining_approval_items
// rows nested under { data: { items } }; the request detail lives in the
// per-kind `requestPayload` JSON. We map defensively to the card shape so the
// screen renders regardless of which request-kind populated the payload.
interface RawApprovalItem {
  readonly id: string
  readonly requestKind?: string
  readonly requestPayload?: unknown
  readonly status?: string
  readonly createdAt?: string
}

interface DecisionsEnvelope {
  readonly success: boolean
  readonly data?: { readonly items?: ReadonlyArray<RawApprovalItem> }
}

function humanizeKind(kind: string | undefined): string {
  if (!kind) return 'Decision'
  return kind.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function toDecisionRow(raw: RawApprovalItem): DecisionRow {
  const payload =
    raw.requestPayload && typeof raw.requestPayload === 'object'
      ? (raw.requestPayload as Record<string, unknown>)
      : {}
  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence.filter((e): e is string => typeof e === 'string')
    : []
  const status: DecisionStatus =
    raw.status === 'approved' || raw.status === 'rejected' ? raw.status : 'pending'
  const riskLevel: RiskLevel =
    payload.riskLevel === 'low' || payload.riskLevel === 'high'
      ? payload.riskLevel
      : 'med'
  return {
    id: raw.id,
    title:
      typeof payload.title === 'string' && payload.title.length > 0
        ? payload.title
        : humanizeKind(raw.requestKind),
    summary:
      typeof payload.summary === 'string'
        ? payload.summary
        : typeof payload.description === 'string'
          ? payload.description
          : '',
    riskLevel,
    status,
    evidence,
    createdAt: raw.createdAt ?? '',
  }
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PendingDecisions />
      </ScreenShell>
    </RoleGuard>
  )
}

function PendingDecisions(): JSX.Element {
  const queryClient = useQueryClient()
  const query = useQuery<ReadonlyArray<DecisionRow>, ApiError>({
    queryKey: ['mining', 'cockpit', 'decisions'],
    queryFn: async ({ signal }) => {
      const body = await miningApi.get<DecisionsEnvelope>('/cockpit/decisions', {
        signal
      })
      return (body.data?.items ?? []).map(toDecisionRow)
    }
  })

  const mutation = useMutation<
    void,
    ApiError,
    { id: string; outcome: 'approved' | 'rejected' },
    { previous: ReadonlyArray<DecisionRow> | undefined }
  >({
    mutationFn: async ({ id, outcome }) => {
      // The decisions queue is backed by mining_approval_items; the live
      // transition routes are POST /approvals/:id/approve|reject (reject needs
      // a mandatory reason). The decision id IS the approval-item id from the
      // GET above, so the same id addresses both surfaces.
      const verb = outcome === 'approved' ? 'approve' : 'reject'
      const reqBody = outcome === 'rejected' ? { reason: COPY.rejectReason } : {}
      await miningApi.post(`/approvals/${encodeURIComponent(id)}/${verb}`, reqBody)
    },
    onMutate: async ({ id, outcome }) => {
      await queryClient.cancelQueries({ queryKey: ['mining', 'cockpit', 'decisions'] })
      const previous = queryClient.getQueryData<ReadonlyArray<DecisionRow>>([
        'mining',
        'cockpit',
        'decisions'
      ])
      if (previous) {
        const next: ReadonlyArray<DecisionRow> = previous.map((row) =>
          row.id === id ? { ...row, status: outcome } : row
        )
        queryClient.setQueryData(['mining', 'cockpit', 'decisions'], next)
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['mining', 'cockpit', 'decisions'], context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['mining', 'cockpit', 'decisions'] })
    }
  })

  const onApprove = useCallback(
    (id: string) => {
      mutation.mutate({ id, outcome: 'approved' })
    },
    [mutation]
  )

  const onReject = useCallback(
    (id: string) => {
      mutation.mutate({ id, outcome: 'rejected' })
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
    return (
      <View>
        <PreviewBanner kind={isOfflineError(query.error) ? 'offline' : 'env-missing'} />
        <Text style={styles.missingPath}>{MISSING_ENDPOINT}</Text>
      </View>
    )
  }

  const rows = query.data ?? []
  if (rows.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  const pendingCount = rows.filter((row) => row.status === 'pending').length

  return (
    <View>
      {mutation.isError ? (
        <Text style={styles.toast} accessibilityRole="alert">
          {COPY.mutationErrorPrefix}
          {mutation.error?.message ?? 'unknown'}
        </Text>
      ) : null}
      <Section title={COPY.sectionTitle} hint={COPY.pendingHint(pendingCount, rows.length)}>
        {rows.map((decision) => (
          <DecisionCard
            key={decision.id}
            decision={decision}
            disabled={mutation.isPending}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
      </Section>
      <Section title={COPY.fingerprintTitle} hint={COPY.fingerprintHint}>
        <FingerprintPlaceholder label={COPY.fingerprintLabel} />
      </Section>
    </View>
  )
}

interface DecisionCardProps {
  decision: DecisionRow
  disabled: boolean
  onApprove: (id: string) => void
  onReject: (id: string) => void
}

function DecisionCard({
  decision,
  disabled,
  onApprove,
  onReject
}: DecisionCardProps): JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{decision.title}</Text>
        <Text style={[styles.badge, badgeStyle(decision.riskLevel)]}>
          {riskLabel(decision.riskLevel)}
        </Text>
      </View>
      <Text style={styles.cardSummary}>{decision.summary}</Text>
      {decision.evidence.length > 0 ? (
        <View style={styles.reasons}>
          {decision.evidence.map((reason, idx) => (
            <Text key={`${decision.id}-r-${idx}`} style={styles.reason}>
              {idx + 1}. {reason}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.statusHint}>{statusLabel(decision.status)}</Text>
      {decision.status === 'pending' ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.approve}
            disabled={disabled}
            onPress={() => onApprove(decision.id)}
            style={({ pressed }) => [
              styles.actionApprove,
              (pressed || disabled) && styles.actionPressed
            ]}
          >
            <Text style={styles.actionLabel}>{COPY.approve}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.reject}
            disabled={disabled}
            onPress={() => onReject(decision.id)}
            style={({ pressed }) => [
              styles.actionReject,
              (pressed || disabled) && styles.actionPressed
            ]}
          >
            <Text style={styles.actionLabel}>{COPY.reject}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function isOfflineError(error: ApiError | null): boolean {
  return error !== null && error.status === 0
}

function riskLabel(risk: RiskLevel): string {
  if (risk === 'high') return COPY.riskHigh
  if (risk === 'med') return COPY.riskMed
  return COPY.riskLow
}

function statusLabel(status: DecisionStatus): string {
  if (status === 'approved') return COPY.statusApproved
  if (status === 'rejected') return COPY.statusRejected
  return COPY.statusPending
}

function badgeStyle(risk: RiskLevel): { backgroundColor: string; color: string } {
  if (risk === 'high') return { backgroundColor: colors.danger, color: colors.textInverse }
  if (risk === 'med') return { backgroundColor: colors.warn, color: colors.textInverse }
  return { backgroundColor: colors.success, color: colors.textInverse }
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: spacing.xl,
    alignItems: 'center'
  },
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
  missingPath: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontFamily: 'monospace',
    marginTop: spacing.sm
  },
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700',
    flex: 1,
    paddingRight: spacing.sm
  },
  cardSummary: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  statusHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.sm,
    fontStyle: 'italic'
  },
  badge: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  reasons: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: 1
  },
  reason: {
    color: colors.text,
    fontSize: fontSize.body,
    marginBottom: spacing.xs
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md
  },
  actionApprove: {
    flex: 1,
    backgroundColor: colors.success,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  actionReject: {
    flex: 1,
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  actionPressed: {
    opacity: 0.8
  },
  actionLabel: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.body
  }
})
