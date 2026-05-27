import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { API_BASE_URL } from '../../src/api/config'
import { request } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-13'
const TRAINING_PATH = '/api/v1/training'

const COPY = {
  loading: 'Inapakia mada... · Loading topics...',
  empty: 'Hakuna mada za toolbox kwa sasa. · No toolbox topics now.',
  errorPrefix: 'Hitilafu: ',
  ackOk: 'Toolbox-talk imethibitishwa kwenye seva.',
  ackQueued: 'Imehifadhiwa offline kwa sync.'
} as const

interface TrainingAssignment {
  readonly id: string
  readonly status: string
  readonly title?: string
  readonly pathTitle?: string
  readonly stepCount?: number
  readonly assignedAt?: string
}

interface AssignmentsResponse {
  readonly success: true
  readonly data: ReadonlyArray<TrainingAssignment>
}

interface MarkCompleteResponse {
  readonly success: true
  readonly data: unknown
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ToolboxTalk />
      </ScreenShell>
    </RoleGuard>
  )
}

function ToolboxTalk(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => [SCREEN_ID, 'training-assignments', user?.id ?? ''],
    [user?.id]
  )
  const [ackedIds, setAckedIds] = useState<ReadonlyArray<string>>([])
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  const query = useQuery<AssignmentsResponse, ApiError>({
    queryKey,
    queryFn: () =>
      request<AssignmentsResponse>(`${API_BASE_URL}${TRAINING_PATH}/assignments`, {
        query: { assigneeUserId: user?.id, status: 'assigned' }
      }),
    enabled: Boolean(user)
  })

  const mutation = useMutation<MarkCompleteResponse, ApiError, string>({
    mutationFn: async (assignmentId) =>
      request<MarkCompleteResponse>(
        `${API_BASE_URL}${TRAINING_PATH}/assignments/${assignmentId}/mark-complete`,
        { method: 'POST', body: {} }
      ),
    onSuccess: () => {
      setConfirmation('ok')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: async (error, assignmentId) => {
      if (error.status === 0 || !online) {
        await enqueueWrite('toolbox_ack', {
          assignmentId,
          ackedAtIso: new Date().toISOString(),
          source: SCREEN_ID
        })
        setConfirmation('queued')
      }
    }
  })

  const assignments = query.data?.data ?? []

  const toggle = useCallback(
    (id: string): void => {
      setAckedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    },
    []
  )

  const allDone = useMemo(
    () => assignments.length > 0 && assignments.every((a) => ackedIds.includes(a.id)),
    [assignments, ackedIds]
  )

  const onSign = useCallback((): void => {
    if (!allDone) return
    // Mark every assigned topic complete; surface a single confirmation.
    for (const a of assignments) {
      mutation.mutate(a.id)
    }
  }, [allDone, assignments, mutation])

  const networkError = query.error?.status === 0 || query.error?.status === 503

  return (
    <View>
      <Section title="Mada ya leo">
        {query.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : null}
        {query.error && networkError ? <PreviewBanner kind="env-missing" /> : null}
        {query.error && !networkError ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{query.error.message}</Text>
        ) : null}
        {!query.isLoading && !query.error && assignments.length === 0 ? (
          <View>
            <PreviewBanner kind="no-data" />
            <Text style={styles.muted}>{COPY.empty}</Text>
          </View>
        ) : null}
        {assignments.length > 0 ? (
          <View>
            <Text style={styles.progress}>
              {ackedIds.filter((id) => assignments.some((a) => a.id === id)).length} / {assignments.length}
            </Text>
            {assignments.map((topic) => {
              const acked = ackedIds.includes(topic.id)
              return (
                <Pressable
                  key={topic.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: acked }}
                  accessibilityLabel={topic.title ?? topic.pathTitle ?? topic.id}
                  onPress={() => toggle(topic.id)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={[styles.checkbox, acked && styles.checkboxChecked]}>
                    {acked ? <Text style={styles.tick}>✓</Text> : null}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowPrimary}>
                      {topic.title ?? topic.pathTitle ?? `Mada #${topic.id.slice(0, 6)}`}
                    </Text>
                    <Text style={styles.rowSecondary}>
                      {topic.stepCount ? `${topic.stepCount} hatua · ` : ''}
                      Hali: {topic.status}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        ) : null}
      </Section>
      <Section title="Thibitisha kwa kidole">
        {confirmation === 'ok' ? (
          <View style={styles.signed}>
            <Text style={styles.signedTitle}>{COPY.ackOk}</Text>
          </View>
        ) : confirmation === 'queued' ? (
          <View style={[styles.signed, styles.signedWarn]}>
            <Text style={styles.signedWarnTitle}>{COPY.ackQueued}</Text>
          </View>
        ) : (
          <View>
            {!allDone ? (
              <Text style={styles.note}>Bonyeza mada zote kabla ya kusaini</Text>
            ) : null}
            {mutation.isPending ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.gold} />
                <Text style={styles.muted}>{COPY.loading}</Text>
              </View>
            ) : (
              <FingerprintPlaceholder
                label={allDone ? 'Saini kwa kidole' : 'Inasubiri…'}
                onSign={onSign}
              />
            )}
          </View>
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {mutation.error && mutation.error.status !== 0 && mutation.error.status !== 503 ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{mutation.error.message}</Text>
        ) : null}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  pressed: {
    opacity: 0.85
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.earth700,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    backgroundColor: colors.surface
  },
  checkboxChecked: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  tick: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  rowBody: {
    flex: 1
  },
  rowPrimary: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  rowSecondary: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  note: {
    color: colors.warn,
    fontSize: fontSize.body,
    textAlign: 'center',
    marginBottom: spacing.sm
  },
  signed: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.success
  },
  signedWarn: {
    borderLeftColor: colors.warn
  },
  signedTitle: {
    color: colors.success,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  signedWarnTitle: {
    color: colors.warn,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  progress: {
    color: colors.earth700,
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
