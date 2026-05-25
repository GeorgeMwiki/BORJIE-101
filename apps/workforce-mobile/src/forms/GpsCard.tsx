import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { LocationState } from '../location/useLocation'
import type { NearestFenceResult } from '../location/fence'

export interface GpsCardProps {
  state: LocationState
  fence: NearestFenceResult | null
  insideLabel: string
  outsideLabel: string
  capturingLabel: string
  latLngLabel: string
  accuracyLabel: string
  distanceLabel: string
  noGpsLabel: string
}

function formatNumber(value: number, fractionDigits = 4): string {
  return value.toFixed(fractionDigits)
}

export function GpsCard({
  state,
  fence,
  insideLabel,
  outsideLabel,
  capturingLabel,
  latLngLabel,
  accuracyLabel,
  distanceLabel,
  noGpsLabel
}: GpsCardProps): JSX.Element {
  if (state.status === 'requesting') {
    return (
      <View style={[styles.card, styles.cardNeutral]}>
        <Text style={styles.title}>{capturingLabel}</Text>
      </View>
    )
  }
  if (!state.coords) {
    return (
      <View style={[styles.card, styles.cardNeutral]}>
        <Text style={styles.title}>{noGpsLabel}</Text>
        {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      </View>
    )
  }
  const insideFence = fence?.insideFence ?? false
  return (
    <View style={[styles.card, insideFence ? styles.cardGood : styles.cardBad]}>
      <Text style={[styles.title, insideFence ? styles.titleGood : styles.titleBad]}>
        {insideFence ? insideLabel : outsideLabel}
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>{latLngLabel}</Text>
        <Text style={styles.value}>
          {formatNumber(state.coords.latitude)} / {formatNumber(state.coords.longitude)}
        </Text>
      </View>
      {state.coords.accuracy !== null ? (
        <View style={styles.row}>
          <Text style={styles.label}>{accuracyLabel}</Text>
          <Text style={styles.value}>{state.coords.accuracy.toFixed(0)} m</Text>
        </View>
      ) : null}
      {fence ? (
        <View style={styles.row}>
          <Text style={styles.label}>
            {distanceLabel} ({fence.fence.siteName})
          </Text>
          <Text style={styles.value}>{fence.distance.toFixed(0)} m</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  cardNeutral: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border
  },
  cardGood: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.success
  },
  cardBad: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.danger
  },
  title: {
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  titleGood: {
    color: colors.success
  },
  titleBad: {
    color: colors.danger
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  value: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
