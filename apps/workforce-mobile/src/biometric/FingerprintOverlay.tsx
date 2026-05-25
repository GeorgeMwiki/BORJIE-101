import { useEffect } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFingerprintSign, type FingerprintResult } from './useFingerprintSign'
import { Button } from '../forms/Button'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface FingerprintOverlayProps {
  visible: boolean
  title: string
  subtitle: string
  successLabel: string
  failedLabel: string
  cancelLabel: string
  retryLabel: string
  promptMessage?: string
  onCancel: () => void
  onSuccess: (result: FingerprintResult) => void
}

/**
 * Reusable biometric sign overlay. Visible-controlled by parent; on appear
 * it kicks off the system biometric prompt and calls onSuccess once. Reset
 * happens automatically on visibility flip so the same component can sign
 * multiple actions in sequence.
 */
export function FingerprintOverlay({
  visible,
  title,
  subtitle,
  successLabel,
  failedLabel,
  cancelLabel,
  retryLabel,
  promptMessage,
  onCancel,
  onSuccess
}: FingerprintOverlayProps): JSX.Element {
  const fingerprint = useFingerprintSign()

  useEffect(() => {
    if (!visible) {
      fingerprint.reset()
      return
    }
    void fingerprint.sign(promptMessage).then((result) => {
      if (result) {
        onSuccess(result)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.ringWrap}>
            <View
              style={[
                styles.ring,
                fingerprint.state.status === 'success' ? styles.ringSuccess : null,
                fingerprint.state.status === 'error' ? styles.ringError : null
              ]}
            >
              <View style={styles.ringInner} />
            </View>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {fingerprint.state.status === 'success' ? (
            <Text style={styles.success}>{successLabel}</Text>
          ) : null}
          {fingerprint.state.status === 'error' ? (
            <Text style={styles.error}>{failedLabel}</Text>
          ) : null}
          <View style={styles.actions}>
            {fingerprint.state.status === 'error' ? (
              <Button
                label={retryLabel}
                onPress={() => {
                  void fingerprint.sign(promptMessage).then((result) => {
                    if (result) {
                      onSuccess(result)
                    }
                  })
                }}
              />
            ) : null}
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 20, 16, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400
  },
  ringWrap: {
    alignItems: 'center',
    marginBottom: spacing.lg
  },
  ring: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.earth500,
    alignItems: 'center',
    justifyContent: 'center'
  },
  ringSuccess: {
    borderColor: colors.success
  },
  ringError: {
    borderColor: colors.danger
  },
  ringInner: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.earth300
  },
  title: {
    color: colors.earth900,
    fontSize: fontSize.h2,
    fontWeight: '700',
    textAlign: 'center'
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    textAlign: 'center',
    marginTop: spacing.xs
  },
  success: {
    color: colors.success,
    fontSize: fontSize.lead,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.md
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.lead,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.md
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm
  }
})
