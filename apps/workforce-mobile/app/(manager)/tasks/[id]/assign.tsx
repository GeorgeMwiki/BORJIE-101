/**
 * Commercial chain L4 — manager assigns a task to a worker.
 *
 * Screen-id: M-M-02. Reached from /(manager)/tasks via tap.
 *
 * The picker accepts a worker UUID + optional shift UUID + optional
 * bilingual note. On submit hits `useAssignTaskToWorker` which posts
 * to /api/v1/mining/tasks/:id/assign-worker. Success routes back to
 * the manager queue with a toast-like banner.
 *
 * No worker-roster query yet (the worker list endpoint is rolling
 * out under workforce/invites); the manager pastes the worker id
 * directly or scans from the crew roster on a separate screen.
 */

import { useCallback, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { ScreenShell } from '../../../../src/components/ScreenShell'
import { Section } from '../../../../src/components/Section'
import { Button } from '../../../../src/forms/Button'
import { useAssignTaskToWorker } from '../../../../src/manager/useManagerTasks'
import { useI18n } from '../../../../src/i18n/useI18n'
import { colors } from '../../../../src/theme/colors'
import { fontSize, radius, spacing } from '../../../../src/theme/spacing'

const SCREEN_ID = 'M-M-02'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function AssignTaskScreen(): JSX.Element {
  const params = useLocalSearchParams<{ id: string }>()
  const taskId = String(params.id ?? '')
  const assign = useAssignTaskToWorker()
  const { lang } = useI18n()
  const isSw = lang === 'sw'

  const [workerId, setWorkerId] = useState<string>('')
  const [shiftId, setShiftId] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [submitted, setSubmitted] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const workerValid = UUID_PATTERN.test(workerId.trim())
  const shiftValid = shiftId.trim().length === 0 || UUID_PATTERN.test(shiftId.trim())
  const canSubmit = workerValid && shiftValid && !assign.isPending && !submitted

  const onSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit) return
    setErrorMsg(null)
    try {
      await assign.mutateAsync({
        taskId,
        workerId: workerId.trim(),
        ...(shiftId.trim() ? { shiftId: shiftId.trim() } : {}),
        ...(note.trim()
          ? isSw
            ? { noteSw: note.trim() }
            : { noteEn: note.trim() }
          : {}),
      })
      setSubmitted(true)
      // Tiny delay before routing back so the banner renders.
      setTimeout(() => router.back(), 800)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'assign failed'
      setErrorMsg(msg)
    }
  }, [assign, canSubmit, isSw, note, shiftId, taskId, workerId])

  return (
    <ScreenShell screenId={SCREEN_ID}>
      <Section
        title={isSw ? 'Mfanyakazi' : 'Worker'}
        hint={
          isSw
            ? 'Andika ID ya mfanyakazi (UUID).'
            : "Enter the worker's user id (UUID)."
        }
      >
        <TextInput
          value={workerId}
          onChangeText={setWorkerId}
          placeholder="00000000-0000-0000-0000-000000000000"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!assign.isPending && !submitted}
          style={[styles.input, !workerValid && workerId.length > 0 && styles.inputInvalid]}
          accessibilityLabel={isSw ? 'ID ya mfanyakazi' : 'Worker id'}
        />
      </Section>

      <Section
        title={isSw ? 'Zamu (hiari)' : 'Shift (optional)'}
        hint={
          isSw
            ? 'ID ya zamu inayohitajika ya kazi hii.'
            : 'Shift id this task should be slotted into.'
        }
      >
        <TextInput
          value={shiftId}
          onChangeText={setShiftId}
          placeholder="00000000-0000-0000-0000-000000000000"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!assign.isPending && !submitted}
          style={[styles.input, !shiftValid && styles.inputInvalid]}
          accessibilityLabel={isSw ? 'ID ya zamu' : 'Shift id'}
        />
      </Section>

      <Section
        title={isSw ? 'Maelezo (hiari)' : 'Notes (optional)'}
        hint={
          isSw
            ? 'Habari ya ziada kwa mfanyakazi.'
            : 'Extra context for the worker.'
        }
      >
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={
            isSw ? 'Habari za ziada…' : 'Additional info…'
          }
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          editable={!assign.isPending && !submitted}
          style={[styles.input, styles.inputMultiline]}
          accessibilityLabel={isSw ? 'Maelezo' : 'Note'}
        />
      </Section>

      {errorMsg ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      {submitted ? (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>
            {isSw
              ? 'Imepangwa kwa mfanyakazi. Inarudi kwenye orodha…'
              : 'Assigned to worker. Returning to queue…'}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={
            assign.isPending
              ? isSw
                ? 'Inatuma…'
                : 'Assigning…'
              : isSw
                ? 'Panga kazi'
                : 'Assign task'
          }
          onPress={onSubmit}
          disabled={!canSubmit}
        />
      </View>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.earth700,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: fontSize.body,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  actions: {
    marginTop: spacing.lg,
  },
  errorBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#3A1818',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.caption,
  },
  successBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#1A2C24',
    borderWidth: 1,
    borderColor: colors.success,
  },
  successText: {
    color: colors.success,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
})
