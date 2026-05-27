import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { API_BASE_URL } from '../../src/api/config'
import { request } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-22'
const TRAINING_PATH = '/api/v1/training'

const COPY = {
  loading: 'Inapakia mafunzo... · Loading training catalogue...',
  empty: 'Hakuna mafunzo umepangiwa. · No training paths assigned.',
  errorPrefix: 'Hitilafu: ',
  startedOk: 'Mafunzo yameanza kwenye seva.'
} as const

interface AssignmentRow {
  readonly id: string
  readonly status: string
  readonly title?: string
  readonly pathTitle?: string
  readonly pathId?: string
  readonly stepCount?: number
  readonly assignedAt?: string
}

interface AssignmentsResponse {
  readonly success: true
  readonly data: ReadonlyArray<AssignmentRow>
}

interface NextStepResponse {
  readonly success: true
  readonly data: { readonly assignmentId?: string; readonly conceptId?: string; readonly title?: string } | null
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <TrainingLibrary />
      </ScreenShell>
    </RoleGuard>
  )
}

function TrainingLibrary(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => [SCREEN_ID, 'training-assignments', user?.id ?? ''],
    [user?.id]
  )
  const nextKey = useMemo(() => [SCREEN_ID, 'training-next', user?.id ?? ''], [user?.id])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'idle' | 'ok'>('idle')

  const list = useQuery<AssignmentsResponse, ApiError>({
    queryKey,
    queryFn: () =>
      request<AssignmentsResponse>(`${API_BASE_URL}${TRAINING_PATH}/assignments`, {
        query: { assigneeUserId: user?.id }
      }),
    enabled: Boolean(user)
  })

  const nextStep = useQuery<NextStepResponse, ApiError>({
    queryKey: nextKey,
    queryFn: () => request<NextStepResponse>(`${API_BASE_URL}${TRAINING_PATH}/next-step`),
    enabled: Boolean(user)
  })

  const completeMutation = useMutation<unknown, ApiError, string>({
    mutationFn: async (assignmentId) =>
      request<{ success: true; data: unknown }>(
        `${API_BASE_URL}${TRAINING_PATH}/assignments/${assignmentId}/mark-complete`,
        { method: 'POST', body: {} }
      ),
    onSuccess: () => {
      setConfirmation('ok')
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: nextKey })
    }
  })

  const assignments = list.data?.data ?? []
  const completed = assignments.filter((a) => a.status === 'completed')
  const networkError = list.error?.status === 0 || list.error?.status === 503

  const onActivate = useCallback((id: string): void => {
    setActiveId(id)
  }, [])

  const onMarkComplete = useCallback(
    (id: string): void => {
      completeMutation.mutate(id)
    },
    [completeMutation]
  )

  return (
    <View>
      <Section title="Mafunzo · Kiswahili">
        {list.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : null}
        {list.error && networkError ? <PreviewBanner kind="env-missing" /> : null}
        {list.error && !networkError ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{list.error.message}</Text>
        ) : null}
        {!list.isLoading && !list.error && assignments.length === 0 ? (
          <View>
            <PreviewBanner kind="no-data" />
            <Text style={styles.muted}>{COPY.empty}</Text>
          </View>
        ) : null}
        {assignments.length > 0 ? (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Mafunzo yaliyokamilika</Text>
            <Text style={styles.summaryValue}>
              {completed.length} / {assignments.length}
            </Text>
          </View>
        ) : null}
      </Section>
      {nextStep.data?.data ? (
        <Section title="Hatua inayofuata">
          <View style={styles.next}>
            <Text style={styles.nextTitle}>{nextStep.data.data.title ?? 'Hatua inayofuata'}</Text>
            <Text style={styles.nextMeta}>
              {nextStep.data.data.assignmentId ? `Assignment: ${nextStep.data.data.assignmentId.slice(0, 8)}…` : ''}
            </Text>
          </View>
        </Section>
      ) : null}
      {assignments.length > 0 ? (
        <Section title="Orodha ya mafunzo">
          {assignments.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={row.title ?? row.pathTitle ?? row.id}
              onPress={() => onActivate(row.id)}
              style={({ pressed }) => [
                styles.videoRow,
                activeId === row.id ? styles.videoRowActive : null,
                pressed && styles.pressed
              ]}
            >
              <View style={styles.playIcon}>
                <Text style={styles.playIconLabel}>▶</Text>
              </View>
              <View style={styles.videoBody}>
                <Text style={styles.videoTitle}>
                  {row.title ?? row.pathTitle ?? `Mafunzo #${row.id.slice(0, 6)}`}
                </Text>
                <Text style={styles.videoMeta}>
                  {row.stepCount ? `${row.stepCount} hatua · ` : ''}
                  Hali: {row.status}
                </Text>
                <View style={styles.statusContainer}>
                  <View style={[styles.statusDot, dotStyleFor(row.status)]} />
                  <Text style={styles.statusText}>{statusLabel(row.status)}</Text>
                  {row.status !== 'completed' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Maliza"
                      onPress={() => onMarkComplete(row.id)}
                      disabled={completeMutation.isPending}
                      style={({ pressed }) => [
                        styles.markBtn,
                        pressed && styles.pressed
                      ]}
                    >
                      <Text style={styles.markBtnLabel}>
                        {completeMutation.isPending ? '...' : 'Maliza'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
          {confirmation === 'ok' ? <Text style={styles.successText}>{COPY.startedOk}</Text> : null}
          {completeMutation.error && completeMutation.error.status !== 0 && completeMutation.error.status !== 503 ? (
            <Text style={styles.errorText}>
              {COPY.errorPrefix}{completeMutation.error.message}
            </Text>
          ) : null}
        </Section>
      ) : null}
      {!online ? <PreviewBanner kind="offline" /> : null}
    </View>
  )
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Imekamilika'
  if (status === 'in_progress') return 'Inaendelea'
  return 'Imepangiwa'
}

function dotStyleFor(status: string): { backgroundColor: string } {
  if (status === 'completed') return { backgroundColor: colors.success }
  if (status === 'in_progress') return { backgroundColor: colors.warn }
  return { backgroundColor: colors.textMuted }
}

const styles = StyleSheet.create({
  summary: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  summaryValue: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  next: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold
  },
  nextTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  nextMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  videoRowActive: {
    borderColor: colors.gold,
    backgroundColor: colors.surface
  },
  pressed: {
    opacity: 0.85
  },
  playIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md
  },
  playIconLabel: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  videoBody: {
    flex: 1
  },
  videoTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  videoMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill
  },
  statusText: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  markBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.earth700,
    borderRadius: radius.sm
  },
  markBtnLabel: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
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
  successText: {
    color: colors.success,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    fontWeight: '600'
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
