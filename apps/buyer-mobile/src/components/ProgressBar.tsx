import { StyleSheet, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius } from '@/theme/spacing'

export interface ProgressBarProps {
  readonly value: number // 0..1
}

export function ProgressBar({ value }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden'
  },
  fill: { height: '100%', backgroundColor: colors.forest, borderRadius: radius.pill }
})
