import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-12'
const MISSING_HISTORY_ENDPOINT = 'GET /api/v1/mining/attendance'

const COPY = {
  loading: 'Inatuma... · Submitting...',
  emptyHistory: 'Historia ya zamu haitaonyeshwa hadi endpoint ya orodha iundwe.',
  errorPrefix: 'Hitilafu: ',
  missing: `Endpoint haijaundwa: ${MISSING_HISTORY_ENDPOINT}`,
  inOk: 'Umeingia kazini kwenye seva.',
  outOk: 'Umetoka kazini kwenye seva.',
  queued: 'Imehifadhiwa offline kwa sync.'
} as const

interface AttendanceRow {
  readonly id: string
  readonly signedOffAt: string | null
  readonly hoursWorked: string | null
}

interface AttendanceResponse {
  readonly success: true
  readonly data: AttendanceRow
}

interface CheckInPayload {
  readonly employeeId: string
  readonly siteId: string
  readonly workDate: string
  readonly shiftKind: 'day' | 'night'
  readonly lat: number
  readonly lon: number
  readonly withinFence: boolean
}

interface CheckOutPayload {
  readonly attendanceId: string
  readonly lat: number
  readonly lon: number
  readonly withinFence: boolean
}

interface LocalSegment {
  readonly id: string
  readonly startedAtISO: string
  readonly endedAtISO: string | null
  readonly attendanceId: string | null
  readonly hoursWorked: string | null
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <HoursLog />
      </ScreenShell>
    </RoleGuard>
  )
}

function HoursLog(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const [segments, setSegments] = useState<ReadonlyArray<LocalSegment>>([])
  const [openSegmentId, setOpenSegmentId] = useState<string | null>(null)
  const [notice, setNotice] = useState<'idle' | 'in-ok' | 'out-ok' | 'queued'>('idle')

  const checkInMutation = useMutation<AttendanceRow, ApiError, CheckInPayload>({
    mutationFn: async (input) => {
      const resp = await miningApi.post<AttendanceResponse>('/attendance/check-in', input)
      return resp.data
    },
    onSuccess: (row) => {
      const local: LocalSegment = {
        id: row.id,
        startedAtISO: new Date().toISOString(),
        endedAtISO: null,
        attendanceId: row.id,
        hoursWorked: null
      }
      setSegments((prev) => [local, ...prev])
      setOpenSegmentId(row.id)
      setNotice('in-ok')
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        const queued = await enqueueWrite('attendance', { ...input, kind: 'check-in' })
        const local: LocalSegment = {
          id: queued.id,
          startedAtISO: new Date().toISOString(),
          endedAtISO: null,
          attendanceId: null,
          hoursWorked: null
        }
        setSegments((prev) => [local, ...prev])
        setOpenSegmentId(queued.id)
        setNotice('queued')
      }
    }
  })

  const checkOutMutation = useMutation<AttendanceRow, ApiError, CheckOutPayload>({
    mutationFn: async (input) => {
      const resp = await miningApi.post<AttendanceResponse>('/attendance/check-out', input)
      return resp.data
    },
    onSuccess: (row) => {
      setSegments((prev) =>
        prev.map((segment) =>
          segment.attendanceId === row.id
            ? {
                ...segment,
                endedAtISO: row.signedOffAt ?? new Date().toISOString(),
                hoursWorked: row.hoursWorked
              }
            : segment
        )
      )
      setOpenSegmentId(null)
      setNotice('out-ok')
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        await enqueueWrite('attendance', { ...input, kind: 'check-out' })
        setSegments((prev) =>
          prev.map((segment) =>
            segment.id === openSegmentId
              ? { ...segment, endedAtISO: new Date().toISOString() }
              : segment
          )
        )
        setOpenSegmentId(null)
        setNotice('queued')
      }
    }
  })

  const clockIn = useCallback((): void => {
    if (!user) return
    const today = new Date().toISOString().slice(0, 10)
    checkInMutation.mutate({
      employeeId: user.id,
      siteId: user.tenantId,
      workDate: today,
      shiftKind: 'day',
      lat: 0,
      lon: 0,
      withinFence: true
    })
  }, [checkInMutation, user])

  const clockOut = useCallback((): void => {
    if (!openSegmentId) return
    const active = segments.find((s) => s.id === openSegmentId)
    if (!active || !active.attendanceId) {
      // Offline-started segment without a server id — close locally only.
      setSegments((prev) =>
        prev.map((segment) =>
          segment.id === openSegmentId
            ? { ...segment, endedAtISO: new Date().toISOString() }
            : segment
        )
      )
      setOpenSegmentId(null)
      setNotice('queued')
      return
    }
    checkOutMutation.mutate({
      attendanceId: active.attendanceId,
      lat: 0,
      lon: 0,
      withinFence: true
    })
  }, [checkOutMutation, openSegmentId, segments])

  const todayHours = useMemo<number>(() => sumHours(segments, isToday), [segments])
  const weekHours = useMemo<number>(() => sumHours(segments, isThisWeek), [segments])

  const clockedIn = openSegmentId !== null
  const submitting = checkInMutation.isPending || checkOutMutation.isPending
  const submitError = checkInMutation.error ?? checkOutMutation.error
  const networkError = submitError?.status === 0 || submitError?.status === 503

  return (
    <View>
      <Section title="Hali ya zamu">
        {submitting ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : clockedIn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mwisho Saa"
            onPress={clockOut}
            style={({ pressed }) => [styles.bigButton, styles.stop, pressed && styles.pressed]}
          >
            <Text style={styles.bigButtonLabel}>Mwisho Saa</Text>
            <Text style={styles.bigButtonHint}>Bonyeza ili kumaliza zamu</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Anza Saa"
            onPress={clockIn}
            style={({ pressed }) => [styles.bigButton, styles.start, pressed && styles.pressed]}
          >
            <Text style={styles.bigButtonLabelDark}>Anza Saa</Text>
            <Text style={styles.bigButtonHintDark}>Bonyeza ili kuanza zamu</Text>
          </Pressable>
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {notice === 'in-ok' ? <Text style={styles.successText}>{COPY.inOk}</Text> : null}
        {notice === 'out-ok' ? <Text style={styles.successText}>{COPY.outOk}</Text> : null}
        {notice === 'queued' ? <Text style={styles.warnText}>{COPY.queued}</Text> : null}
        {submitError && !networkError ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{submitError.message}</Text>
        ) : null}
      </Section>
      <Section title="Muhtasari">
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Leo</Text>
            <Text style={styles.summaryValue}>{todayHours.toFixed(1)} hrs</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Wiki hii</Text>
            <Text style={styles.summaryValue}>{weekHours.toFixed(1)} hrs</Text>
          </View>
        </View>
      </Section>
      <Section title="Kumbukumbu ya zamu">
        <PreviewBanner kind="env-missing" />
        <Text style={styles.missing}>{COPY.missing}</Text>
        {segments.length === 0 ? (
          <Text style={styles.muted}>{COPY.emptyHistory}</Text>
        ) : (
          segments.map((segment) => (
            <View key={segment.id} style={styles.segment}>
              <Text style={styles.segmentPrimary}>{formatRange(segment)}</Text>
              <Text style={styles.segmentSecondary}>{describeDuration(segment)}</Text>
            </View>
          ))
        )}
      </Section>
    </View>
  )
}

function isToday(iso: string): boolean {
  const then = new Date(iso)
  const now = new Date()
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  )
}

function isThisWeek(iso: string): boolean {
  const then = new Date(iso).getTime()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  return Date.now() - then < sevenDaysMs
}

function sumHours(
  segments: ReadonlyArray<LocalSegment>,
  filter: (iso: string) => boolean
): number {
  return segments
    .filter((segment) => filter(segment.startedAtISO))
    .reduce((total, segment) => {
      const end = segment.endedAtISO ? new Date(segment.endedAtISO).getTime() : Date.now()
      const start = new Date(segment.startedAtISO).getTime()
      return total + Math.max(0, end - start) / (60 * 60 * 1000)
    }, 0)
}

function formatRange(segment: LocalSegment): string {
  const start = new Date(segment.startedAtISO)
  const end = segment.endedAtISO ? new Date(segment.endedAtISO) : null
  return `${formatTime(start)} – ${end ? formatTime(end) : 'inaendelea'}`
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function describeDuration(segment: LocalSegment): string {
  if (segment.hoursWorked) return `${Number(segment.hoursWorked).toFixed(1)} hrs (seva)`
  const end = segment.endedAtISO ? new Date(segment.endedAtISO).getTime() : Date.now()
  const hours = (end - new Date(segment.startedAtISO).getTime()) / (60 * 60 * 1000)
  return `${hours.toFixed(1)} hrs`
}

const styles = StyleSheet.create({
  bigButton: {
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    alignItems: 'center'
  },
  start: {
    backgroundColor: colors.gold
  },
  stop: {
    backgroundColor: colors.danger
  },
  pressed: {
    opacity: 0.85
  },
  bigButtonLabel: {
    color: colors.textInverse,
    fontSize: fontSize.h1,
    fontWeight: '700'
  },
  bigButtonHint: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    opacity: 0.9
  },
  bigButtonLabelDark: {
    color: colors.earth900,
    fontSize: fontSize.h1,
    fontWeight: '700'
  },
  bigButtonHintDark: {
    color: colors.earth900,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    opacity: 0.85
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md
  },
  summaryCard: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  summaryValue: {
    color: colors.text,
    fontSize: fontSize.h2,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  segment: {
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1
  },
  segmentPrimary: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  segmentSecondary: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  missing: {
    color: colors.warn,
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  successText: {
    color: colors.success,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    fontWeight: '600'
  },
  warnText: {
    color: colors.warn,
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
