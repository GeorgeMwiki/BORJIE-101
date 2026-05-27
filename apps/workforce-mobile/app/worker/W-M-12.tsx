import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-12'

interface HourSegment {
  id: string
  startedAtISO: string
  endedAtISO: string | null
}

const SEED_SEGMENTS: ReadonlyArray<HourSegment> = [
  { id: 's-1', startedAtISO: '2026-05-27T06:00:00Z', endedAtISO: '2026-05-27T11:30:00Z' },
  { id: 's-2', startedAtISO: '2026-05-26T05:45:00Z', endedAtISO: '2026-05-26T14:10:00Z' },
  { id: 's-3', startedAtISO: '2026-05-25T06:08:00Z', endedAtISO: '2026-05-25T15:32:00Z' }
]

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
  const [segments, setSegments] = useState<ReadonlyArray<HourSegment>>(SEED_SEGMENTS)
  const [activeId, setActiveId] = useState<string | null>(null)

  const clockIn = useCallback((): void => {
    const id = `s-${Date.now()}`
    const segment: HourSegment = {
      id,
      startedAtISO: new Date().toISOString(),
      endedAtISO: null
    }
    setSegments([segment, ...segments])
    setActiveId(id)
  }, [segments])

  const clockOut = useCallback((): void => {
    if (!activeId) return
    setSegments(
      segments.map((segment) =>
        segment.id === activeId
          ? { ...segment, endedAtISO: new Date().toISOString() }
          : segment
      )
    )
    setActiveId(null)
  }, [activeId, segments])

  const todayHours = useMemo<number>(() => sumHours(segments, isToday), [segments])
  const weekHours = useMemo<number>(() => sumHours(segments, isThisWeek), [segments])

  const clockedIn = activeId !== null

  return (
    <View>
      <Section title="Hali ya zamu">
        {clockedIn ? (
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
        {segments.map((segment) => (
          <View key={segment.id} style={styles.segment}>
            <Text style={styles.segmentPrimary}>{formatRange(segment)}</Text>
            <Text style={styles.segmentSecondary}>{describeDuration(segment)}</Text>
          </View>
        ))}
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
  segments: ReadonlyArray<HourSegment>,
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

function formatRange(segment: HourSegment): string {
  const start = new Date(segment.startedAtISO)
  const end = segment.endedAtISO ? new Date(segment.endedAtISO) : null
  return `${formatTime(start)} – ${end ? formatTime(end) : 'inaendelea'}`
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function describeDuration(segment: HourSegment): string {
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
  }
})
