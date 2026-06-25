import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { localizeApiError } from '@borjie/error-catalog'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-03'

const COPY = {
  loading: 'Inapakia mada za toolbox... · Loading briefing topics...',
  empty: 'Hakuna mada za toolbox bado. · No toolbox topics yet.',
  loadError: 'Imeshindwa kupakia mada. · Failed to load topics.',
  ackOk: 'Briefing imethibitishwa kwenye seva.',
  ackQueued: 'Briefing imehifadhiwa kwa sync ya baadaye.'
} as const

interface ToolboxTopicRow {
  readonly id: string
  readonly topicSw: string
  readonly topicEn: string | null
  readonly briefingNotesSw: string | null
  readonly scheduledFor: string | null
}

interface ToolboxTopicsResponse {
  readonly success: true
  readonly data: { readonly items: ReadonlyArray<ToolboxTopicRow> }
}

interface CheckInRequest {
  readonly employeeId: string
  readonly siteId: string
  readonly workDate: string
  readonly shiftKind: 'day' | 'night'
  readonly lat: number
  readonly lon: number
  readonly withinFence: boolean
  readonly fingerprintEventId?: string
}

interface AttendanceRow {
  readonly id: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <BriefingView />
      </ScreenShell>
    </RoleGuard>
  )
}

function BriefingView(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const { lang } = useI18n()
  const isSw = lang === 'sw'
  const [signedFlag, setSignedFlag] = useState<'idle' | 'ok' | 'queued'>('idle')

  const topicsQuery = useQuery<ReadonlyArray<ToolboxTopicRow>, ApiError>({
    queryKey: ['mining', 'attendance', 'toolbox-topics'],
    queryFn: async ({ signal }) => {
      const resp = await miningApi.get<ToolboxTopicsResponse>('/attendance/toolbox-topics', {
        signal
      })
      return resp.data?.items ?? []
    }
  })

  const mutation = useMutation<AttendanceRow, ApiError, CheckInRequest>({
    mutationFn: async (input) =>
      miningApi.post<{ success: true; data: AttendanceRow }>('/attendance/check-in', input).then((r) => r.data),
    onSuccess: () => {
      setSignedFlag('ok')
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        await enqueueWrite('attendance', input)
        setSignedFlag('queued')
      }
    }
  })

  const onSign = useCallback((): void => {
    if (!user) return
    const today = new Date().toISOString().slice(0, 10)
    mutation.mutate({
      employeeId: user.id,
      siteId: user.tenantId,
      workDate: today,
      shiftKind: 'day',
      lat: 0,
      lon: 0,
      withinFence: true,
      fingerprintEventId: `fp-briefing-${Date.now()}`
    })
  }, [mutation, user])

  const submitting = mutation.isPending
  const submitError = mutation.error
  const submitNetwork = submitError?.status === 0 || !online
  const submitMissing = submitError?.status === 503
  const successCopy = useMemo<string | null>(() => {
    if (signedFlag === 'ok') return COPY.ackOk
    if (signedFlag === 'queued') return COPY.ackQueued
    return null
  }, [signedFlag])

  const topics = topicsQuery.data ?? []

  return (
    <View>
      <Section title="Mada za toolbox">
        {topicsQuery.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.loadingText}>{COPY.loading}</Text>
          </View>
        ) : topicsQuery.isError ? (
          <Text style={styles.empty}>{COPY.loadError}</Text>
        ) : topics.length === 0 ? (
          <Text style={styles.empty}>{COPY.empty}</Text>
        ) : (
          topics.map((topic) => {
            // Active-locale heading; null active-locale value shows a neutral
            // placeholder, NEVER the other language (no topicEn ?? topicSw).
            const heading = isSw
              ? topic.topicSw || '—'
              : topic.topicEn || '—'
            return (
              <View key={topic.id} style={styles.topicRow}>
                <Text style={styles.topicTitle}>{heading}</Text>
                {isSw && topic.briefingNotesSw ? (
                  <Text style={styles.topicNotes}>{topic.briefingNotesSw}</Text>
                ) : null}
              </View>
            )
          })
        )}
      </Section>
      <Section title="Thibitisha kwa kidole">
        {signedFlag === 'idle' ? (
          submitting ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.gold} />
              <Text style={styles.loadingText}>{COPY.loading}</Text>
            </View>
          ) : (
            <FingerprintPlaceholder label="Saini briefing" onSign={onSign} />
          )
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={successCopy ?? ''}
            onPress={() => undefined}
            style={styles.signedBox}
          >
            <Text style={styles.signedText}>{successCopy}</Text>
          </Pressable>
        )}
        {submitError && !submitNetwork && !submitMissing ? (
          <Text style={styles.errorText}>
            {localizeApiError(submitError.code, lang)}
          </Text>
        ) : null}
        {submitNetwork ? <PreviewBanner kind="offline" /> : null}
        {submitMissing ? <PreviewBanner kind="env-missing" /> : null}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  topicRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  topicTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  topicNotes: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    gap: spacing.md
  },
  loadingText: {
    color: colors.earth700,
    fontSize: fontSize.body
  },
  signedBox: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.success
  },
  signedText: {
    color: colors.success,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
