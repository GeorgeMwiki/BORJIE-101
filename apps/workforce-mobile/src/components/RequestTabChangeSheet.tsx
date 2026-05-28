/**
 * RequestTabChangeSheet — Wave WORKFORCE-FIXED-TABS.
 *
 * Bottom-sheet a worker opens from "Profile → Request a tab change".
 * The brain also opens this auto-magically when it detects intent like
 * "I need access to dispatch" — the request is NEVER auto-applied;
 * Mr. Mwikila (the MD persona on workforce-mobile) routes it to the
 * owner portal for review.
 *
 * Submits to POST /api/v1/workforce/tab-change-requests.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import {
  MANDATORY_WORKFORCE_TAB_IDS,
  listTabsAllowedForRole,
  type WorkforceRoleId,
  type WorkforceTabSpec
} from '@borjie/persona-runtime'
import { request } from '../api/client'
import { useI18n } from '../i18n/useI18n'
import { tokens } from '../ui-litfin'
import type { ResolvedWorkforceTab } from '../lib/hooks/useWorkforceTabConfig'

export interface RequestTabChangeSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly role: WorkforceRoleId
  readonly siteId?: string | null
  readonly currentTabs: ReadonlyArray<ResolvedWorkforceTab>
  readonly initialReason?: string
}

interface ApiResponse {
  readonly success: boolean
  readonly data?: { readonly id: string; readonly status: string }
  readonly error?: { readonly code: string; readonly message: string }
}

const COPY = {
  en: {
    title: 'Request a tab change',
    body: 'Tell Mr. Mwikila what you need access to. Your manager will review.',
    reason: 'Reason',
    reasonPlaceholder: 'Why do you need this change?',
    addTabs: 'Tabs to add',
    removeTabs: 'Tabs to remove',
    densityChange: 'Layout density',
    densityComfortable: 'Comfortable',
    densityCompact: 'Compact',
    cancel: 'Cancel',
    submit: 'Send to Mr. Mwikila',
    submitting: 'Sending…',
    sent:
      'Sent to Mr. Mwikila. Your manager will review and you will see the change as soon as it is approved.',
    error: 'Could not send the request',
    locked: '(always visible)'
  },
  sw: {
    title: 'Omba mabadiliko ya tabo',
    body:
      'Mwambie Bw. Mwikila unachohitaji kufikia. Meneja wako atakagua.',
    reason: 'Sababu',
    reasonPlaceholder: 'Kwa nini unahitaji mabadiliko haya?',
    addTabs: 'Tabo za kuongeza',
    removeTabs: 'Tabo za kuondoa',
    densityChange: 'Mpangilio wa nafasi',
    densityComfortable: 'Wazi',
    densityCompact: 'Bana',
    cancel: 'Ghairi',
    submit: 'Tuma kwa Bw. Mwikila',
    submitting: 'Inatuma…',
    sent:
      'Imetumwa kwa Bw. Mwikila. Meneja wako atakagua na utaona mabadiliko mara tu yatakapoidhinishwa.',
    error: 'Imeshindikana kutuma ombi',
    locked: '(daima inaonekana)'
  }
} as const

export function RequestTabChangeSheet(
  props: RequestTabChangeSheetProps
): JSX.Element {
  const { visible, onClose, role, siteId, currentTabs, initialReason } = props
  const { lang } = useI18n()
  const copy = COPY[lang]

  const allowed = useMemo(() => listTabsAllowedForRole(role), [role])
  const currentTabIds = useMemo(
    () => new Set(currentTabs.map((t) => t.id)),
    [currentTabs]
  )

  const [reason, setReason] = useState<string>(initialReason ?? '')
  const [addTabs, setAddTabs] = useState<ReadonlyArray<string>>([])
  const [removeTabs, setRemoveTabs] = useState<ReadonlyArray<string>>([])
  const [density, setDensity] = useState<'comfortable' | 'compact' | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [doneMessage, setDoneMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const toggle = useCallback(
    (
      list: ReadonlyArray<string>,
      setList: (next: ReadonlyArray<string>) => void,
      id: string
    ) => {
      if (list.includes(id)) {
        setList(list.filter((x) => x !== id))
      } else {
        setList([...list, id])
      }
    },
    []
  )

  const submit = useCallback(async () => {
    if (reason.trim().length < 4) {
      setErrorMessage(copy.reasonPlaceholder)
      return
    }
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const payload: Record<string, unknown> = {
        reason: reason.trim(),
        requestedChanges: {
          ...(addTabs.length > 0 ? { addTabs } : {}),
          ...(removeTabs.length > 0 ? { removeTabs } : {}),
          ...(density ? { densityChange: density } : {})
        }
      }
      if (siteId) {
        payload.siteId = siteId
      }
      const resp = await request<ApiResponse>(
        '/api/v1/workforce/tab-change-requests',
        { method: 'POST', body: payload }
      )
      if (!resp?.success) {
        throw new Error(resp?.error?.message ?? copy.error)
      }
      setDoneMessage(copy.sent)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : copy.error)
    } finally {
      setSubmitting(false)
    }
  }, [addTabs, copy.error, copy.reasonPlaceholder, copy.sent, density, reason, removeTabs, siteId])

  const renderTabChip = (
    spec: WorkforceTabSpec,
    selectedList: ReadonlyArray<string>,
    setList: (next: ReadonlyArray<string>) => void,
    disabled = false
  ): JSX.Element => {
    const isSelected = selectedList.includes(spec.id)
    return (
      <Pressable
        key={spec.id}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => toggle(selectedList, setList, spec.id)}
        style={[
          styles.chip,
          isSelected ? styles.chipSelected : null,
          disabled ? styles.chipDisabled : null
        ]}
      >
        <Text
          style={[
            styles.chipText,
            isSelected ? styles.chipTextSelected : null,
            disabled ? styles.chipTextDisabled : null
          ]}
        >
          {spec.label[lang]}
          {disabled ? ` ${copy.locked}` : ''}
        </Text>
      </Pressable>
    )
  }

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.body}>{copy.body}</Text>

            {doneMessage ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{doneMessage}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>{copy.reason}</Text>
            <TextInput
              accessibilityLabel={copy.reason}
              value={reason}
              onChangeText={setReason}
              multiline
              placeholder={copy.reasonPlaceholder}
              placeholderTextColor={tokens.color.textMuted}
              style={styles.input}
            />

            <Text style={styles.label}>{copy.addTabs}</Text>
            <View style={styles.chipRow}>
              {allowed
                .filter((spec) => !currentTabIds.has(spec.id))
                .map((spec) => renderTabChip(spec, addTabs, setAddTabs))}
            </View>

            <Text style={styles.label}>{copy.removeTabs}</Text>
            <View style={styles.chipRow}>
              {allowed
                .filter((spec) => currentTabIds.has(spec.id))
                .map((spec) => {
                  const isMandatory = MANDATORY_WORKFORCE_TAB_IDS.includes(
                    spec.id
                  )
                  return renderTabChip(spec, removeTabs, setRemoveTabs, isMandatory)
                })}
            </View>

            <Text style={styles.label}>{copy.densityChange}</Text>
            <View style={styles.chipRow}>
              {(['comfortable', 'compact'] as const).map((d) => {
                const isSel = density === d
                return (
                  <Pressable
                    key={d}
                    accessibilityRole="button"
                    onPress={() => setDensity(isSel ? null : d)}
                    style={[styles.chip, isSel ? styles.chipSelected : null]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isSel ? styles.chipTextSelected : null
                      ]}
                    >
                      {d === 'comfortable'
                        ? copy.densityComfortable
                        : copy.densityCompact}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            {errorMessage ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelText}>{copy.cancel}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={submitting || Boolean(doneMessage)}
                onPress={submit}
                style={[
                  styles.submitButton,
                  submitting || doneMessage ? styles.submitButtonDisabled : null
                ]}
              >
                <Text style={styles.submitText}>
                  {submitting ? copy.submitting : copy.submit}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end'
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: tokens.color.bgRaised,
    borderTopLeftRadius: tokens.radius.xl,
    borderTopRightRadius: tokens.radius.xl,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: tokens.color.borderGold
  },
  scroll: {
    paddingBottom: 32
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: tokens.color.gold,
    marginBottom: 6
  },
  body: {
    fontSize: 14,
    color: tokens.color.textSecondary,
    marginBottom: 16,
    lineHeight: 20
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.color.textPrimary,
    marginTop: 18,
    marginBottom: 8,
    letterSpacing: 0.4,
    textTransform: 'uppercase'
  },
  input: {
    minHeight: 80,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: tokens.color.textPrimary,
    fontSize: 15,
    textAlignVertical: 'top'
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: tokens.color.bgSurface
  },
  chipSelected: {
    backgroundColor: tokens.color.gold,
    borderColor: tokens.color.gold
  },
  chipDisabled: {
    opacity: 0.4
  },
  chipText: {
    color: tokens.color.textPrimary,
    fontWeight: '600',
    fontSize: 13
  },
  chipTextSelected: {
    color: tokens.color.userBubbleText
  },
  chipTextDisabled: {
    color: tokens.color.textMuted
  },
  successBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: tokens.radius.md,
    backgroundColor: 'rgba(46, 174, 96, 0.18)',
    borderWidth: 1,
    borderColor: tokens.color.success
  },
  successText: {
    color: tokens.color.success,
    fontSize: 14,
    lineHeight: 20
  },
  errorText: {
    color: tokens.color.danger,
    fontSize: 13,
    marginTop: 12
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    justifyContent: 'flex-end'
  },
  cancelButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border
  },
  cancelText: {
    color: tokens.color.textPrimary,
    fontWeight: '600'
  },
  submitButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.gold
  },
  submitButtonDisabled: {
    opacity: 0.6
  },
  submitText: {
    color: tokens.color.userBubbleText,
    fontWeight: '700'
  }
})
