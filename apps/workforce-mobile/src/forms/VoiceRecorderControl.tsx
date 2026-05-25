import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { VoiceRecorderState } from '../media/useVoiceRecorder'

export interface VoiceRecorderControlProps {
  state: VoiceRecorderState
  onStart: () => void
  onStop: () => void
  onReset: () => void
  recordLabel: string
  stopLabel: string
  retakeLabel: string
  emptyLabel: string
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return `${mm}:${ss}`
}

export function VoiceRecorderControl({
  state,
  onStart,
  onStop,
  onReset,
  recordLabel,
  stopLabel,
  retakeLabel,
  emptyLabel
}: VoiceRecorderControlProps): JSX.Element {
  const isRecording = state.status === 'recording'
  const hasRecording = state.recording !== null
  return (
    <View style={styles.wrap}>
      {!hasRecording ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? stopLabel : recordLabel}
          onPress={isRecording ? onStop : onStart}
          style={({ pressed }) => [
            styles.button,
            isRecording ? styles.buttonRecording : styles.buttonIdle,
            pressed ? styles.buttonPressed : null
          ]}
        >
          <Text
            style={[
              styles.buttonLabel,
              isRecording ? styles.buttonLabelRecording : styles.buttonLabelIdle
            ]}
          >
            {isRecording ? stopLabel : recordLabel}
          </Text>
          <Text
            style={[
              styles.duration,
              isRecording ? styles.durationRecording : styles.durationIdle
            ]}
          >
            {formatDuration(state.durationMs)}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.recordedRow}>
          <View>
            <Text style={styles.recordedLabel}>{formatDuration(state.durationMs)}</Text>
            <Text style={styles.recordedHint}>{state.recording?.uri ?? ''}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onReset} style={styles.retake}>
            <Text style={styles.retakeLabel}>{retakeLabel}</Text>
          </Pressable>
        </View>
      )}
      {!hasRecording && !isRecording ? <Text style={styles.empty}>{emptyLabel}</Text> : null}
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md
  },
  button: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center'
  },
  buttonIdle: {
    backgroundColor: colors.earth100,
    borderWidth: 1,
    borderColor: colors.earth500
  },
  buttonRecording: {
    backgroundColor: colors.danger
  },
  buttonPressed: {
    opacity: 0.85
  },
  buttonLabel: {
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  buttonLabelIdle: {
    color: colors.earth900
  },
  buttonLabelRecording: {
    color: colors.textInverse
  },
  duration: {
    marginTop: spacing.xs,
    fontSize: fontSize.body
  },
  durationIdle: {
    color: colors.textMuted
  },
  durationRecording: {
    color: colors.textInverse
  },
  recordedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md
  },
  recordedLabel: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  recordedHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    maxWidth: 200
  },
  retake: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.earth700,
    borderRadius: radius.md
  },
  retakeLabel: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
