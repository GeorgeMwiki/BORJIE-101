import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { PreviewBanner } from '../../components/PreviewBanner'
import type { PerformanceSnapshotData } from './types'

export interface PerformanceSnapshotProps {
  readonly data: PerformanceSnapshotData | undefined
  readonly loading: boolean
  readonly error: Error | null
  readonly lang: 'sw' | 'en'
}

function deltaPrefix(delta: number): string {
  if (delta > 0) {
    return '+'
  }
  if (delta < 0) {
    return ''
  }
  return '±'
}

function deltaTone(delta: number): string {
  if (delta > 0) {
    return colors.success
  }
  if (delta < 0) {
    return colors.danger
  }
  return colors.textMuted
}

/**
 * One number + one delta. R2 anti-pattern explicitly forbids streaks /
 * charts on the worker home — Strava-ring pattern compressed to two lines
 * of text per worker-guidance §9 §3.
 */
export function PerformanceSnapshot({
  data,
  loading,
  error,
  lang
}: PerformanceSnapshotProps): JSX.Element {
  if (loading) {
    return <Text style={styles.lead}>Inapakia takwimu… / Loading stats…</Text>
  }
  if (error) {
    return <PreviewBanner kind="env-missing" />
  }
  if (!data) {
    return <PreviewBanner kind="no-data" />
  }

  const label = lang === 'sw' ? data.metricLabelSw : data.metricLabelEn
  const unit = lang === 'sw' ? data.metricUnitSw : data.metricUnitEn
  const deltaColor = deltaTone(data.deltaPct)
  const deltaText = `${deltaPrefix(data.deltaPct)}${data.deltaPct.toFixed(0)}% siku ${data.rangeDays} / ${data.rangeDays}d`

  return (
    <View style={styles.wrap} accessibilityLabel={`${label}: ${data.metricValue} ${unit}`}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Text style={styles.value}>{data.metricValue.toFixed(0)}</Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
      <Text style={[styles.delta, { color: deltaColor }]} testID="employee-home-perf-delta">
        {deltaText}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.sm
  },
  value: {
    color: colors.earth900,
    fontSize: 44,
    fontWeight: '800'
  },
  unit: {
    color: colors.earth700,
    fontSize: fontSize.h3,
    marginLeft: spacing.sm,
    fontWeight: '600'
  },
  delta: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  lead: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    paddingVertical: spacing.md
  }
})
