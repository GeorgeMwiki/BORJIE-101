/**
 * Commercial chain L4 — manager assigns a task to a worker.
 *
 * Screen-id: M-M-02. Reached from /(manager)/tasks via tap.
 *
 * The screen offers a WORKER PICKER (the active tenant's roster from
 * GET /api/v1/mining/tasks/assignable-workers) so the manager selects a
 * worker by name instead of pasting a raw UUID; manual UUID entry stays as
 * a fallback. On submit it hits `useAssignTaskToWorker` which posts to
 * /api/v1/mining/tasks/:id/assign-worker. Success routes back to the manager
 * queue with a banner.
 *
 * All copy flows through the `managerAssign` i18n namespace (single language
 * per active locale — no inline `isSw ? '…' : '…'` ternaries) and every
 * gateway error is localized by code via `localizeApiError` from the shared
 * @borjie/error-catalog — never the raw English `err.message` (which under
 * `sw` is language mixing).
 */

import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { localizeApiError } from '@borjie/error-catalog'
import { ScreenShell } from '../../../../src/components/ScreenShell'
import { Section } from '../../../../src/components/Section'
import { RoleGuard } from '../../../../src/components/RoleGuard'
import { Button } from '../../../../src/forms/Button'
import { ApiError } from '../../../../src/api/errors'
import {
  useAssignTaskToWorker,
  useAssignableWorkers,
  type AssignableWorker,
} from '../../../../src/manager/useManagerTasks'
import { useI18n } from '../../../../src/i18n/useI18n'
import { colors } from '../../../../src/theme/colors'
import { fontSize, radius, spacing } from '../../../../src/theme/spacing'

const SCREEN_ID = 'M-M-02'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIN_TAP_DP = 56

export default function AssignTaskScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <AssignTaskView />
    </RoleGuard>
  )
}

function AssignTaskView(): JSX.Element {
  const params = useLocalSearchParams<{ id: string }>()
  const taskId = String(params.id ?? '')
  const assign = useAssignTaskToWorker()
  const roster = useAssignableWorkers()
  const { lang, t } = useI18n()
  const copy = t.managerAssign

  const [workerId, setWorkerId] = useState<string>('')
  const [shiftId, setShiftId] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [manualMode, setManualMode] = useState<boolean>(false)
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
        // The note is a single user-authored free-text string in the active
        // locale; tag it to the active locale's field only (no bilingual mix).
        ...(note.trim()
          ? lang === 'sw'
            ? { noteSw: note.trim() }
            : { noteEn: note.trim() }
          : {}),
      })
      setSubmitted(true)
      // Tiny delay before routing back so the banner renders.
      setTimeout(() => router.back(), 800)
    } catch (err) {
      // Localize by the gateway error code in the active locale — never the
      // raw English `err.message` (under `sw` that is language mixing).
      setErrorMsg(
        err instanceof ApiError
          ? localizeApiError(err.code, lang)
          : localizeApiError(undefined, lang),
      )
    }
  }, [assign, canSubmit, lang, note, shiftId, taskId, workerId])

  const disabled = assign.isPending || submitted

  return (
    <ScreenShell screenId={SCREEN_ID}>
      <Section title={copy.workerTitle} hint={copy.workerHint}>
        {manualMode ? (
          <TextInput
            value={workerId}
            onChangeText={setWorkerId}
            placeholder="00000000-0000-0000-0000-000000000000"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            style={[
              styles.input,
              !workerValid && workerId.length > 0 && styles.inputInvalid,
            ]}
            accessibilityLabel={copy.manualA11y}
          />
        ) : (
          <WorkerPicker
            workers={roster.data ?? []}
            loading={roster.isPending}
            error={roster.isError}
            selectedId={workerId}
            disabled={disabled}
            copy={copy}
            onSelect={setWorkerId}
          />
        )}
        <Pressable
          onPress={() => {
            setManualMode((m) => !m)
            setWorkerId('')
          }}
          disabled={disabled}
          accessibilityRole="button"
          style={styles.modeToggle}
        >
          <Text style={styles.modeToggleText}>
            {manualMode ? copy.workerTitle : copy.manualToggle}
          </Text>
        </Pressable>
        {manualMode ? <Text style={styles.hint}>{copy.manualHint}</Text> : null}
      </Section>

      <Section title={copy.shiftTitle} hint={copy.shiftHint}>
        <TextInput
          value={shiftId}
          onChangeText={setShiftId}
          placeholder="00000000-0000-0000-0000-000000000000"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          style={[styles.input, !shiftValid && styles.inputInvalid]}
          accessibilityLabel={copy.shiftA11y}
        />
      </Section>

      <Section title={copy.noteTitle} hint={copy.noteHint}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={copy.notePlaceholder}
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          editable={!disabled}
          style={[styles.input, styles.inputMultiline]}
          accessibilityLabel={copy.noteA11y}
        />
      </Section>

      {errorMsg ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      {submitted ? (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{copy.success}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={assign.isPending ? copy.submitting : copy.submit}
          onPress={onSubmit}
          disabled={!canSubmit}
        />
      </View>
    </ScreenShell>
  )
}

interface WorkerPickerProps {
  readonly workers: ReadonlyArray<AssignableWorker>
  readonly loading: boolean
  readonly error: boolean
  readonly selectedId: string
  readonly disabled: boolean
  readonly copy: {
    readonly workerPickerLoading: string
    readonly workerPickerEmpty: string
    readonly workerPickerError: string
  }
  readonly onSelect: (id: string) => void
}

/**
 * Selectable worker roster. Each row passes its id to `onSelect`, which feeds
 * `useAssignTaskToWorker`. Loading / empty / error states are localized.
 */
function WorkerPicker({
  workers,
  loading,
  error,
  selectedId,
  disabled,
  copy,
  onSelect,
}: WorkerPickerProps): JSX.Element {
  if (loading) {
    return <Text style={styles.pickerMuted}>{copy.workerPickerLoading}</Text>
  }
  if (error) {
    return <Text style={styles.pickerError}>{copy.workerPickerError}</Text>
  }
  if (workers.length === 0) {
    return <Text style={styles.pickerMuted}>{copy.workerPickerEmpty}</Text>
  }
  return (
    <View>
      {workers.map((w) => {
        const selected = w.id === selectedId
        return (
          <Pressable
            key={w.id}
            onPress={() => onSelect(w.id)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={w.name}
            testID={`assign-worker-${w.id}`}
            style={[styles.workerRow, selected && styles.workerRowSelected]}
          >
            <Text style={[styles.workerName, selected && styles.workerNameSelected]}>
              {w.name}
            </Text>
            <Text style={styles.workerRole}>{w.role}</Text>
          </Pressable>
        )
      })}
    </View>
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
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.sm,
  },
  modeToggle: {
    marginTop: spacing.sm,
    minHeight: MIN_TAP_DP - 16,
    justifyContent: 'center',
  },
  modeToggleText: {
    color: colors.gold,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  pickerMuted: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    paddingVertical: spacing.md,
  },
  pickerError: {
    color: colors.danger,
    fontSize: fontSize.body,
    paddingVertical: spacing.md,
  },
  workerRow: {
    minHeight: MIN_TAP_DP,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    // Dark raised surface (the screen ground is navy-slate); cream type on it
    // clears WCAG AA. `surface` is the cream card token — wrong ground here.
    backgroundColor: colors.earth700,
  },
  workerRowSelected: {
    borderColor: colors.gold,
    borderWidth: 2,
  },
  workerName: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  workerNameSelected: {
    color: colors.gold,
  },
  workerRole: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
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
