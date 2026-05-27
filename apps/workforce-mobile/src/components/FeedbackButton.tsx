import { useCallback, useMemo, useState } from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle
} from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { miningApi } from '../api/client'
import { useI18n } from '../i18n/useI18n'

/**
 * Floating "Niarifu Borjie" feedback button + modal — opt-in mount only.
 *
 * Lifecycle:
 *   - Renders an absolute-positioned floating button at the bottom-right
 *     of its containing ScreenShell (or wherever it's placed). Screens
 *     suppress it by simply not rendering this component — there is no
 *     auto-mount, no global tap-hijack.
 *   - Tap → modal with 1–5 star rating + text area + "Niarifu Borjie"
 *     send button.
 *   - Submit POSTs to `/api/v1/pilot/feedback` via the canonical
 *     `miningApi` client (Supabase JWT attached automatically).
 *   - Optimistic UI: the modal closes the moment Send is pressed; if the
 *     POST fails the user sees a non-blocking error line.
 *
 * No emoji, no animated icons — the pilot devices are mid-range Android
 * with patchy connectivity. Plain text + colour stars keep the surface
 * fast and readable in bright sun.
 */
export interface FeedbackButtonProps {
  readonly screenId?: string
  readonly containerStyle?: ViewStyle
  /** Override the submit handler for tests / Storybook. */
  readonly onSubmit?: (input: FeedbackSubmission) => Promise<void>
  /** Pilot session context attached to every submission. */
  readonly sessionContext?: Record<string, unknown>
}

export interface FeedbackSubmission {
  readonly rating: number
  readonly message: string
  readonly screenId?: string
  readonly sessionContext?: Record<string, unknown>
}

const RATINGS = [1, 2, 3, 4, 5] as const

/** Bilingual labels — Swahili-first per CLAUDE.md. */
const LABELS = {
  open: { sw: 'Niarifu Borjie', en: 'Tell Borjie' },
  title: { sw: 'Tueleze uzoefu wako', en: 'Share your experience' },
  ratingPrompt: { sw: 'Ulipenda kiasi gani?', en: 'How was it?' },
  messagePlaceholder: {
    sw: 'Andika kwa Kiswahili au Kiingereza...',
    en: 'Write in Swahili or English...'
  },
  cancel: { sw: 'Funga', en: 'Close' },
  send: { sw: 'Niarifu Borjie', en: 'Send' },
  error: {
    sw: 'Hatukuweza kutuma — tafadhali jaribu tena',
    en: 'Could not send — please try again'
  }
} as const

function pick(label: { sw: string; en: string }, lang: 'sw' | 'en'): string {
  return lang === 'en' ? label.en : label.sw
}

async function defaultSubmit(input: FeedbackSubmission): Promise<void> {
  await miningApi.post<{ success: boolean }>(
    '/pilot/feedback',
    {
      rating: input.rating,
      message: input.message,
      screenId: input.screenId,
      sessionContext: input.sessionContext
    }
  )
}

export function FeedbackButton({
  screenId,
  containerStyle,
  onSubmit,
  sessionContext
}: FeedbackButtonProps): JSX.Element {
  const { lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitter = useMemo(() => onSubmit ?? defaultSubmit, [onSubmit])

  const reset = useCallback((): void => {
    setRating(0)
    setMessage('')
    setError(null)
  }, [])

  const close = useCallback((): void => {
    setOpen(false)
    reset()
  }, [reset])

  const send = useCallback(async (): Promise<void> => {
    if (submitting) return
    const trimmedMessage = message.trim()
    if (rating < 1 || rating > 5 || trimmedMessage.length === 0) {
      setError(pick(LABELS.error, lang))
      return
    }
    setSubmitting(true)
    setError(null)
    const submission: FeedbackSubmission = {
      rating,
      message: trimmedMessage,
      ...(screenId !== undefined ? { screenId } : {}),
      ...(sessionContext !== undefined ? { sessionContext } : {})
    }
    // Optimistic UI: close first; surface the error inline only if the
    // POST fails (the modal re-opens via the `error` state).
    setOpen(false)
    try {
      await submitter(submission)
      reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pick(LABELS.error, lang))
      setOpen(true)
    } finally {
      setSubmitting(false)
    }
  }, [rating, message, screenId, sessionContext, submitting, submitter, lang, reset])

  return (
    <View
      pointerEvents="box-none"
      style={[styles.floatRoot, containerStyle]}
      testID="feedback-button-root"
    >
      <Pressable
        onPress={(): void => setOpen(true)}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel={pick(LABELS.open, lang)}
        testID="feedback-button-open"
      >
        <Text style={styles.fabText}>{pick(LABELS.open, lang)}</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View style={styles.backdrop}>
          <View style={styles.card} testID="feedback-button-modal">
            <Text style={styles.cardTitle}>{pick(LABELS.title, lang)}</Text>
            <Text style={styles.cardLabel}>{pick(LABELS.ratingPrompt, lang)}</Text>

            <View style={styles.ratingRow}>
              {RATINGS.map((star) => {
                const active = rating >= star
                return (
                  <Pressable
                    key={star}
                    onPress={(): void => setRating(star)}
                    style={[styles.starButton, active ? styles.starActive : styles.starInactive]}
                    accessibilityRole="button"
                    accessibilityLabel={`${star}`}
                    accessibilityState={{ selected: active }}
                    testID={`feedback-button-star-${star}`}
                  >
                    <Text style={[styles.starText, active ? styles.starTextActive : null]}>
                      {`${star}`}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={pick(LABELS.messagePlaceholder, lang)}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              maxLength={1500}
              style={styles.textarea}
              testID="feedback-button-message"
            />

            {error ? (
              <Text style={styles.errorText} testID="feedback-button-error">
                {error}
              </Text>
            ) : null}

            <View style={styles.actionsRow}>
              <Pressable
                onPress={close}
                style={[styles.actionButton, styles.actionCancel]}
                accessibilityRole="button"
                testID="feedback-button-cancel"
              >
                <Text style={styles.actionCancelText}>{pick(LABELS.cancel, lang)}</Text>
              </Pressable>
              <Pressable
                onPress={(): void => {
                  void send()
                }}
                style={[styles.actionButton, styles.actionSend]}
                accessibilityRole="button"
                testID="feedback-button-send"
              >
                <Text style={styles.actionSendText}>{pick(LABELS.send, lang)}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  floatRoot: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.lg,
    zIndex: 100
  },
  fab: {
    backgroundColor: colors.gold,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.goldDark,
    shadowColor: colors.earth900,
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }
  },
  fabText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31,20,16,0.55)',
    justifyContent: 'flex-end'
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.h2,
    fontWeight: '700'
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  ratingRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  starButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1
  },
  starActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  starInactive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border
  },
  starText: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  starTextActive: {
    color: colors.earth900
  },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.body,
    minHeight: 96,
    textAlignVertical: 'top'
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    marginTop: spacing.sm
  },
  actionButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    minWidth: 96,
    alignItems: 'center'
  },
  actionCancel: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border
  },
  actionCancelText: {
    color: colors.text,
    fontWeight: '600'
  },
  actionSend: {
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: colors.goldDark
  },
  actionSendText: {
    color: colors.earth900,
    fontWeight: '700'
  }
})
