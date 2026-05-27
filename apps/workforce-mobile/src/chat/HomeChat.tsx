/**
 * HomeChat — chat-first home tab. The brain (POST /api/v1/brain/turn) is
 * the primary interaction; data surfaces inline via tool-renderable cards.
 *
 * Layout:
 *   - Greeting card (only when there are no turns yet) — persona-aware
 *     copy + 3 suggestion chips.
 *   - Turn list — each turn is a user bubble, an assistant bubble, and
 *     zero-or-more tool-call cards rendered via ToolCallRenderer.
 *   - Composer — TextInput + voice button + paperclip placeholder + send.
 *
 * State lives in useState (ChatTurn[]) and is persisted to AsyncStorage
 * keyed by role so each pilot user keeps their own conversation when the
 * tab unmounts. Persistence is best-effort; storage failures are quietly
 * swallowed so an unwriteable disk never blocks the UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useMutation } from '@tanstack/react-query'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData
} from 'react-native'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n/useI18n'
import { ApiError } from '../api/errors'
import { PreviewBanner } from '../components/PreviewBanner'
import { workforcePersonaSpec } from '../roles/persona'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { postBrainTurn } from './brainTurn'
import { ToolCallRenderer } from './ToolCallRenderer'
import {
  HOME_CHAT_OPENERS,
  openerFor,
  pickLabel,
  type ChatSuggestion
} from './homeChatCopy'
import type { ChatTurn } from './types'

const STORAGE_KEY_PREFIX = 'borjie.home-chat.turns.v1'
const MAX_PERSISTED_TURNS = 40
const PENDING_ID = 'pending'

function storageKey(role: string): string {
  return `${STORAGE_KEY_PREFIX}.${role}`
}

function newTurnId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function HomeChat(): JSX.Element {
  const { user } = useAuth()
  const { lang } = useI18n()
  const role = user?.role ?? 'employee'
  const opener = openerFor(role)
  const personaSlug = workforcePersonaSpec(role).slug

  const [turns, setTurns] = useState<ReadonlyArray<ChatTurn>>([])
  const [pendingUserText, setPendingUserText] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const scrollRef = useRef<ScrollView | null>(null)

  // Restore persisted turns once per role change. Failure is non-fatal —
  // the chat just starts empty.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const raw = await AsyncStorage.getItem(storageKey(role))
        if (raw === null || cancelled) {
          return
        }
        const parsed = JSON.parse(raw) as ReadonlyArray<ChatTurn>
        if (Array.isArray(parsed) && !cancelled) {
          setTurns(parsed)
        }
      } catch {
        // swallow — see file header
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [role])

  // Persist turns whenever they change. Cap the persisted slice so a long
  // pilot session can't blow out AsyncStorage.
  useEffect(() => {
    const persist = async (): Promise<void> => {
      try {
        const slice = turns.slice(-MAX_PERSISTED_TURNS)
        await AsyncStorage.setItem(storageKey(role), JSON.stringify(slice))
      } catch {
        // swallow — see file header
      }
    }
    void persist()
  }, [turns, role])

  const mutation = useMutation({
    mutationFn: (userText: string) =>
      postBrainTurn({ userText, threadId, persona: personaSlug }),
    onSuccess: (data, userText) => {
      const turn: ChatTurn = {
        id: newTurnId(),
        userText,
        responseText: data.responseText,
        toolCalls: data.toolCalls,
        proposedAction: data.proposedAction ?? null,
        createdAtMs: Date.now()
      }
      setTurns((prev) => [...prev, turn])
      setThreadId(data.threadId)
      setPendingUserText(null)
    },
    onError: () => {
      setPendingUserText(null)
    }
  })

  const send = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (trimmed.length === 0 || mutation.isPending) {
        return
      }
      setPendingUserText(trimmed)
      setDraft('')
      mutation.mutate(trimmed)
    },
    [mutation]
  )

  const onSendPress = useCallback((): void => {
    send(draft)
  }, [draft, send])

  const onSubmitEditing = useCallback(
    (event: NativeSyntheticEvent<TextInputSubmitEditingEventData>): void => {
      send(event.nativeEvent.text ?? draft)
    },
    [draft, send]
  )

  const onSuggestionPress = useCallback(
    (suggestion: ChatSuggestion): void => {
      send(suggestion.sw)
    },
    [send]
  )

  const onContentSizeChange = useCallback((): void => {
    if (scrollRef.current) {
      scrollRef.current.scrollToEnd({ animated: true })
    }
  }, [])

  const showGreeting = turns.length === 0 && pendingUserText === null
  const canSend = draft.trim().length > 0 && !mutation.isPending

  return (
    <View style={styles.root} testID="home-chat-root">
      <ScrollView
        ref={scrollRef}
        style={styles.history}
        contentContainerStyle={styles.historyContent}
        onContentSizeChange={onContentSizeChange}
      >
        {showGreeting ? (
          <GreetingCard
            greetingSw={opener.greetingSw}
            greetingEn={opener.greetingEn}
            lang={lang}
            suggestions={opener.suggestions}
            onPick={onSuggestionPress}
            disabled={mutation.isPending}
          />
        ) : null}
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
        {pendingUserText !== null ? (
          <PendingTurnView userText={pendingUserText} lang={lang} />
        ) : null}
        {mutation.isError ? <PreviewBanner kind="env-missing" /> : null}
      </ScrollView>
      <Composer
        draft={draft}
        onChangeDraft={setDraft}
        onSubmit={onSubmitEditing}
        onSendPress={onSendPress}
        canSend={canSend}
        lang={lang}
      />
    </View>
  )
}

interface GreetingCardProps {
  readonly greetingSw: string
  readonly greetingEn: string
  readonly lang: 'sw' | 'en'
  readonly suggestions: ReadonlyArray<ChatSuggestion>
  readonly onPick: (suggestion: ChatSuggestion) => void
  readonly disabled: boolean
}

function GreetingCard({
  greetingSw,
  greetingEn,
  lang,
  suggestions,
  onPick,
  disabled
}: GreetingCardProps): JSX.Element {
  return (
    <View style={styles.greetingCard} testID="home-chat-greeting">
      <Text style={styles.greetingPrimary}>{greetingSw}</Text>
      {lang === 'en' ? <Text style={styles.greetingSecondary}>{greetingEn}</Text> : null}
      <Text style={styles.suggestionsTitle}>
        {pickLabel('suggestionsTitle', lang)}
      </Text>
      <View style={styles.suggestionsWrap}>
        {suggestions.map((suggestion) => (
          <Pressable
            key={suggestion.id}
            onPress={() => onPick(suggestion)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={suggestion.sw}
            testID={`home-chat-suggestion-${suggestion.id}`}
            style={({ pressed }) => [
              styles.suggestionChip,
              pressed ? styles.suggestionChipPressed : null,
              disabled ? styles.suggestionChipDisabled : null
            ]}
          >
            <Text style={styles.suggestionText}>{suggestion.sw}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

interface TurnViewProps {
  readonly turn: ChatTurn
}

function TurnView({ turn }: TurnViewProps): JSX.Element {
  const { lang } = useI18n()
  return (
    <View testID={`home-chat-turn-${turn.id}`}>
      <View style={[styles.bubbleRow, styles.bubbleRowUser]}>
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleUserText}>{turn.userText}</Text>
        </View>
      </View>
      <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
        <View style={[styles.bubble, styles.bubbleAssistant]}>
          <Text style={styles.bubbleAssistantText}>{turn.responseText}</Text>
        </View>
      </View>
      {turn.toolCalls.map((call, index) => (
        <ToolCallRenderer key={`${turn.id}:tool:${index}`} call={call} />
      ))}
      {turn.proposedAction ? (
        <ProposedActionCard action={turn.proposedAction} lang={lang} />
      ) : null}
    </View>
  )
}

function PendingTurnView({
  userText,
  lang
}: {
  readonly userText: string
  readonly lang: 'sw' | 'en'
}): JSX.Element {
  return (
    <View testID={`home-chat-turn-${PENDING_ID}`}>
      <View style={[styles.bubbleRow, styles.bubbleRowUser]}>
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleUserText}>{userText}</Text>
        </View>
      </View>
      <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
        <View style={[styles.bubble, styles.bubbleAssistant]}>
          <Text style={styles.bubbleAssistantTextThinking}>
            {pickLabel('thinking', lang)}
          </Text>
        </View>
      </View>
    </View>
  )
}

interface ProposedActionCardProps {
  readonly action: NonNullable<ChatTurn['proposedAction']>
  readonly lang: 'sw' | 'en'
}

function ProposedActionCard({ action, lang }: ProposedActionCardProps): JSX.Element {
  const riskKey =
    action.riskLevel === 'CRITICAL'
      ? 'riskCritical'
      : action.riskLevel === 'HIGH'
        ? 'riskHigh'
        : action.riskLevel === 'MEDIUM'
          ? 'riskMedium'
          : 'riskLow'
  return (
    <View style={styles.proposedActionWrap} testID="home-chat-proposed-action">
      <Text style={styles.proposedActionLabel}>
        {pickLabel('proposedAction', lang)}
      </Text>
      <Text style={styles.proposedActionBody}>
        {action.verb} · {action.object}
      </Text>
      <Text style={styles.proposedActionMeta}>{pickLabel(riskKey, lang)}</Text>
    </View>
  )
}

interface ComposerProps {
  readonly draft: string
  readonly onChangeDraft: (next: string) => void
  readonly onSubmit: (
    event: NativeSyntheticEvent<TextInputSubmitEditingEventData>
  ) => void
  readonly onSendPress: () => void
  readonly canSend: boolean
  readonly lang: 'sw' | 'en'
}

function Composer({
  draft,
  onChangeDraft,
  onSubmit,
  onSendPress,
  canSend,
  lang
}: ComposerProps): JSX.Element {
  return (
    <View style={styles.composer} testID="home-chat-composer">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pickLabel('attach', lang)}
        style={styles.iconButton}
        testID="home-chat-attach"
      >
        <Text style={styles.iconButtonText}>+</Text>
      </Pressable>
      <TextInput
        value={draft}
        onChangeText={onChangeDraft}
        placeholder={pickLabel('composerPlaceholder', lang)}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        multiline
        onSubmitEditing={onSubmit}
        blurOnSubmit={false}
        testID="home-chat-input"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pickLabel('voice', lang)}
        style={styles.iconButton}
        testID="home-chat-voice"
      >
        <Text style={styles.iconButtonText}>S</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pickLabel('send', lang)}
        onPress={onSendPress}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.sendButton,
          pressed ? styles.sendButtonPressed : null,
          !canSend ? styles.sendButtonDisabled : null
        ]}
        testID="home-chat-send"
      >
        <Text style={styles.sendButtonText}>{pickLabel('send', lang)}</Text>
      </Pressable>
    </View>
  )
}

// Pure helpers re-exported for tests.
export const __internals__ = Object.freeze({
  storageKey,
  STORAGE_KEY_PREFIX,
  MAX_PERSISTED_TURNS,
  openersMap: HOME_CHAT_OPENERS
})

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 320
  },
  history: {
    flex: 1
  },
  historyContent: {
    paddingBottom: spacing.lg
  },
  greetingCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold
  },
  greetingPrimary: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700',
    lineHeight: fontSize.lead * 1.4
  },
  greetingSecondary: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  suggestionsTitle: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.lg
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  suggestionChip: {
    backgroundColor: colors.surface,
    borderColor: colors.goldDark,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center'
  },
  suggestionChipPressed: {
    backgroundColor: colors.gold
  },
  suggestionChipDisabled: {
    opacity: 0.5
  },
  suggestionText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  bubbleRow: {
    flexDirection: 'row',
    marginVertical: spacing.xs
  },
  bubbleRowUser: {
    justifyContent: 'flex-end'
  },
  bubbleRowAssistant: {
    justifyContent: 'flex-start'
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg
  },
  bubbleUser: {
    backgroundColor: colors.gold
  },
  bubbleAssistant: {
    backgroundColor: colors.earth100,
    borderWidth: 1,
    borderColor: colors.border
  },
  bubbleUserText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    lineHeight: 20
  },
  bubbleAssistantText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    lineHeight: 20
  },
  bubbleAssistantTextThinking: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontStyle: 'italic',
    lineHeight: 20
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonText: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.body
  },
  sendButton: {
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center'
  },
  sendButtonPressed: {
    backgroundColor: colors.goldDark
  },
  sendButtonDisabled: {
    opacity: 0.5
  },
  sendButtonText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  proposedActionWrap: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.warn
  },
  proposedActionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  proposedActionBody: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  proposedActionMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})

// Surface the `ApiError` type so consumers (and tests) don't have to walk
// back through `api/errors`. The import is preserved so tree-shaking can
// drop it if the upstream change ever removes it.
export type HomeChatApiError = ApiError
