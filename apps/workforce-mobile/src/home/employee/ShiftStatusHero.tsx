import { useCallback, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { PreviewBanner } from '../../components/PreviewBanner'
import { enqueueWrite } from '../../sync/queue'
import { PRIMARY_CTA_DP, type AttendanceShift } from './types'

export interface ShiftStatusHeroProps {
  readonly shift: AttendanceShift | undefined
  readonly loading: boolean
  readonly error: Error | null
  readonly online: boolean
  readonly userId: string | null
}

function elapsedLabel(seconds: number): string {
  if (seconds <= 0) {
    return '0:00'
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const minPad = minutes.toString().padStart(2, '0')
  return `${hours}:${minPad}`
}

export function ShiftStatusHero({
  shift,
  loading,
  error,
  online,
  userId
}: ShiftStatusHeroProps): JSX.Element {
  const onClockIn = useCallback((): void => {
    if (!userId) {
      return
    }
    void enqueueWrite('attendance', { action: 'clock_in', userId, occurredAt: Date.now() })
  }, [userId])

  const onClockOut = useCallback((): void => {
    if (!userId) {
      return
    }
    void enqueueWrite('attendance', { action: 'clock_out', userId, occurredAt: Date.now() })
  }, [userId])

  const body = useMemo<JSX.Element>(() => {
    if (loading) {
      return <Text style={styles.lead}>Inapakia hali ya zamu… / Loading shift…</Text>
    }
    if (error) {
      return <PreviewBanner kind="env-missing" />
    }
    if (!shift) {
      return <PreviewBanner kind="no-data" />
    }
    if (shift.state === 'not-started') {
      return (
        <View>
          <Text style={styles.headline}>Anza zamu</Text>
          <Text style={styles.sub}>Start shift · {shift.siteName ?? 'Mgodi'}</Text>
          <Pressable
            onPress={onClockIn}
            accessibilityRole="button"
            accessibilityLabel="Anza zamu / Start shift"
            style={({ pressed }) => [styles.cta, pressed ? styles.ctaPressed : null]}
            testID="employee-home-clock-in"
          >
            <Text style={styles.ctaText}>Anza / Start</Text>
          </Pressable>
        </View>
      )
    }
    if (shift.state === 'in-progress' || shift.state === 'on-break') {
      return (
        <View>
          <Text style={styles.timer}>{elapsedLabel(shift.elapsedSeconds)}</Text>
          <Text style={styles.sub}>
            Zamu inaendelea · {shift.siteName ?? 'Mgodi'} / Shift in progress
          </Text>
          <Pressable
            onPress={onClockOut}
            accessibilityRole="button"
            accessibilityLabel="Maliza zamu / End shift"
            style={({ pressed }) => [styles.ctaSecondary, pressed ? styles.ctaPressed : null]}
            testID="employee-home-clock-out"
          >
            <Text style={styles.ctaSecondaryText}>Maliza / End</Text>
          </Pressable>
        </View>
      )
    }
    return <Text style={styles.lead}>Zamu imeisha leo / Shift ended for today</Text>
  }, [loading, error, shift, onClockIn, onClockOut])

  return (
    <View
      style={[styles.wrap, online ? null : styles.wrapOffline]}
      accessibilityLabel="Hali ya zamu / Shift status"
    >
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.earth900,
    padding: spacing.lg,
    borderRadius: radius.lg,
    minHeight: 200
  },
  wrapOffline: {
    borderWidth: 2,
    borderColor: colors.warn
  },
  headline: {
    color: colors.textInverse,
    fontSize: fontSize.h1,
    fontWeight: '700'
  },
  timer: {
    color: colors.goldLight,
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: 1
  },
  sub: {
    color: colors.earth100,
    fontSize: fontSize.lead,
    marginTop: spacing.xs
  },
  lead: {
    color: colors.textInverse,
    fontSize: fontSize.lead
  },
  cta: {
    marginTop: spacing.lg,
    minHeight: PRIMARY_CTA_DP,
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl
  },
  ctaSecondary: {
    marginTop: spacing.lg,
    minHeight: PRIMARY_CTA_DP,
    backgroundColor: colors.earth500,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderWidth: 2,
    borderColor: colors.goldLight
  },
  ctaPressed: {
    opacity: 0.85
  },
  ctaText: {
    color: colors.earth900,
    fontSize: fontSize.h2,
    fontWeight: '800'
  },
  ctaSecondaryText: {
    color: colors.textInverse,
    fontSize: fontSize.h2,
    fontWeight: '800'
  }
})
