/**
 * HomeChat — chat-first home tab with SSE streaming + R7 polish.
 *
 * Wire path:
 *   • Submit → optimistic user bubble paints BEFORE network (R7 §4.1).
 *   • `streamBrainTurn` opens SSE to /api/v1/brain/turn (JSON-fallback
 *     transparent to this surface).
 *   • `accepted` swaps the "anafikiri" placeholder for a streaming
 *     bubble inside Doherty's 400 ms bound.
 *   • `message_chunk` appends text into the live bubble. `Animated`
 *     drives only opacity / transform so the layout thread is free.
 *   • `tool_call` pushes a card into the live turn.
 *   • `proposed_action` attaches the action footer.
 *   • `done` settles the turn and persists to AsyncStorage.
 *   • `error` attaches a FailureDot to the user bubble — NEVER a banner
 *     (R7 §6.1; PreviewBanner is reserved for env-missing / offline /
 *     no-data per CLAUDE.md).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  Animated,
  Easing,
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
import { workforcePersonaSpec } from '../roles/persona'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { greet } from '../ui-litfin'
import { streamBrainTurn, type BrainStreamEvent } from './brainTurn'
import { ChatSkeleton } from './ChatSkeleton'
import { FailureDot } from './FailureDot'
import { SendButton } from './SendButton'
import { ThreeDotPulse } from './ThreeDotPulse'
import { ToolCallRenderer } from './ToolCallRenderer'
import {
  HOME_CHAT_OPENERS,
  openerFor,
  pickLabel,
  type ChatSuggestion
} from './homeChatCopy'
import {
  R7_TIMINGS,
  applyMessageChunk,
  applyProposedAction,
  applyStreamError,
  applyToolCall,
  applyTurnAccepted,
  finaliseTurn,
  newTurnId,
  optimisticTurn,
  toPersistedSlice,
  type LiveTurn,
  type SettledTurn
} from './chatTurns'

const STORAGE_KEY_PREFIX = 'borjie.home-chat.turns.v1'
const MAX_PERSISTED_TURNS = 40
const SKELETON_ONSET_MS = R7_TIMINGS['SKELETON_ONSET_MS'] ?? 200
const SLOW_INDICATOR_MS = R7_TIMINGS['SLOW_INDICATOR_MS'] ?? 3_000
const PULSE_GRACE_MS = R7_TIMINGS['PULSE_GRACE_MS'] ?? 400
const ENTRY_DURATION_MS = R7_TIMINGS['BUBBLE_ENTRY_DURATION_MS'] ?? 200

function storageKey(role: string): string {
  return `${STORAGE_KEY_PREFIX}.${role}`
}

export function HomeChat(): JSX.Element {
  const { user } = useAuth()
  const { lang } = useI18n()
  const role = user?.role ?? 'employee'
  const opener = openerFor(role)
  const personaSlug = workforcePersonaSpec(role).slug

  const [turns, setTurns] = useState<ReadonlyArray<SettledTurn>>([])
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const scrollRef = useRef<ScrollView | null>(null)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showSlow, setShowSlow] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const raw = await AsyncStorage.getItem(storageKey(role))
        if (raw === null || cancelled) {
          return
        }
        const parsed = JSON.parse(raw) as ReadonlyArray<SettledTurn>
        if (Array.isArray(parsed) && !cancelled) {
          setTurns(parsed)
        }
      } catch {
        // best-effort
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [role])

  useEffect(() => {
    const persist = async (): Promise<void> => {
      try {
        await AsyncStorage.setItem(
          storageKey(role),
          JSON.stringify(toPersistedSlice(turns, MAX_PERSISTED_TURNS))
        )
      } catch {
        // best-effort
      }
    }
    void persist()
  }, [turns, role])

  useEffect(() => {
    if (live === null || live.kind === 'failed') {
      setShowSkeleton(false)
      return
    }
    if (
      live.kind === 'pending' ||
      (live.kind === 'streaming' && live.text.length === 0)
    ) {
      const handle = setTimeout(() => setShowSkeleton(true), SKELETON_ONSET_MS)
      return () => clearTimeout(handle)
    }
    setShowSkeleton(false)
    return
  }, [live])

  useEffect(() => {
    if (
      live === null ||
      live.kind === 'streaming-complete' ||
      live.kind === 'failed'
    ) {
      setShowSlow(false)
      return
    }
    const handle = setTimeout(() => setShowSlow(true), SLOW_INDICATOR_MS)
    return () => clearTimeout(handle)
  }, [live])

  const handleEvent = useCallback(
    (turnId: string, event: BrainStreamEvent): void => {
      setLive((prev) => {
        if (prev === null || prev.id !== turnId) {
          return prev
        }
        if (event.kind === 'accepted' && event.data.type === 'accepted') {
          return applyTurnAccepted(prev, event.data.threadId)
        }
        if (event.kind === 'message_chunk' && event.data.type === 'message_chunk') {
          return applyMessageChunk(prev, event.data.delta)
        }
        if (event.kind === 'tool_call' && event.data.type === 'tool_call') {
          return applyToolCall(prev, event.data.toolCall)
        }
        if (
          event.kind === 'proposed_action' &&
          event.data.type === 'proposed_action'
        ) {
          return applyProposedAction(prev, event.data.action)
        }
        return prev
      })
    },
    []
  )

  const submitTurn = useCallback(
    (userText: string): void => {
      const trimmed = userText.trim()
      if (trimmed.length === 0 || live !== null) {
        return
      }
      const fresh = optimisticTurn(trimmed)
      setLive(fresh)
      setDraft('')
      void runStream(fresh, threadId, personaSlug, handleEvent)
        .then((settled) => {
          setLive(null)
          setTurns((prev) => [...prev, settled])
          setThreadId(settled.threadId)
          setShowSkeleton(false)
          setShowSlow(false)
        })
        .catch((cause: unknown) => {
          const message =
            cause instanceof ApiError ? cause.message : 'stream_error'
          setLive((prev) =>
            prev !== null && prev.id === fresh.id
              ? applyStreamError(prev, message)
              : prev
          )
          setShowSkeleton(false)
          setShowSlow(false)
        })
    },
    [handleEvent, live, personaSlug, threadId]
  )

  const onSendPress = useCallback((): void => {
    submitTurn(draft)
  }, [draft, submitTurn])

  const onSubmitEditing = useCallback(
    (event: NativeSyntheticEvent<TextInputSubmitEditingEventData>): void => {
      submitTurn(event.nativeEvent.text ?? draft)
    },
    [draft, submitTurn]
  )

  const onSuggestionPress = useCallback(
    (suggestion: ChatSuggestion): void => {
      submitTurn(lang === 'sw' ? suggestion.sw : suggestion.en)
    },
    [lang, submitTurn]
  )

  const onContentSizeChange = useCallback((): void => {
    if (scrollRef.current) {
      scrollRef.current.scrollToEnd({ animated: true })
    }
  }, [])

  const retryFailedTurn = useCallback(
    (failed: LiveTurn): void => {
      if (failed.kind !== 'failed') {
        return
      }
      setLive(null)
      submitTurn(failed.userText)
    },
    [submitTurn]
  )

  const showGreeting = turns.length === 0 && live === null
  const canSend = draft.trim().length > 0

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
          />
        ) : null}
        {turns.map((turn) => (
          <SettledTurnView key={turn.id} turn={turn} />
        ))}
        {live !== null ? (
          <LiveTurnView
            turn={live}
            lang={lang}
            showSkeleton={showSkeleton}
            showSlow={showSlow}
            pulseGraceMs={PULSE_GRACE_MS}
            onRetry={() => retryFailedTurn(live)}
          />
        ) : null}
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
}

function GreetingCard({
  greetingSw,
  greetingEn,
  lang,
  suggestions,
  onPick
}: GreetingCardProps): JSX.Element {
  const greeting = greet(lang)
  const primary = lang === 'sw' ? greetingSw : greetingEn
  return (
    <View style={styles.greetingCard} testID="home-chat-greeting">
      <Text style={styles.greetingEyebrow}>MR. MWIKILA · MINING MD</Text>
      <Text style={styles.greetingDayPart}>{greeting}</Text>
      <Text style={styles.greetingPrimary}>{primary}</Text>
      {lang === 'sw' ? (
        <Text style={styles.greetingSecondary}>{greetingEn}</Text>
      ) : null}
      <Text style={styles.suggestionsTitle}>
        {pickLabel('suggestionsTitle', lang)}
      </Text>
      <View style={styles.suggestionsWrap}>
        {suggestions.map((suggestion) => (
          <Pressable
            key={suggestion.id}
            onPress={() => onPick(suggestion)}
            accessibilityRole="button"
            accessibilityLabel={suggestion.sw}
            testID={`home-chat-suggestion-${suggestion.id}`}
            style={({ pressed }) => [
              styles.suggestionChip,
              pressed ? styles.suggestionChipPressed : null
            ]}
          >
            <Text style={styles.suggestionText}>{lang === 'sw' ? suggestion.sw : suggestion.en}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function SettledTurnView({ turn }: { readonly turn: SettledTurn }): JSX.Element {
  const { lang } = useI18n()
  return (
    <View testID={`home-chat-turn-${turn.id}`}>
      <BubbleEnter>
        <View style={[styles.bubbleRow, styles.bubbleRowUser]}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            <Text style={styles.bubbleUserText}>{turn.userText}</Text>
          </View>
        </View>
      </BubbleEnter>
      <BubbleEnter>
        <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
          <View style={[styles.bubble, styles.bubbleAssistant]}>
            <Text style={styles.bubbleAssistantText}>{turn.responseText}</Text>
            {turn.citations.length > 0 ? (
              <CitationChips citations={turn.citations} />
            ) : null}
          </View>
        </View>
      </BubbleEnter>
      {turn.toolCalls.map((call, index) => (
        <ToolCallRenderer key={`${turn.id}:tool:${index}`} call={call} />
      ))}
      {turn.proposedAction ? (
        <ProposedActionCard action={turn.proposedAction} lang={lang} />
      ) : null}
    </View>
  )
}

interface LiveTurnViewProps {
  readonly turn: LiveTurn
  readonly lang: 'sw' | 'en'
  readonly showSkeleton: boolean
  readonly showSlow: boolean
  readonly pulseGraceMs: number
  readonly onRetry: () => void
}

function LiveTurnView({
  turn,
  lang,
  showSkeleton,
  showSlow,
  pulseGraceMs,
  onRetry
}: LiveTurnViewProps): JSX.Element {
  const hasStream = turn.kind === 'streaming' && turn.text.length > 0
  const showPulse =
    pulseGraceMs >= 0 &&
    (turn.kind === 'pending' ||
      (turn.kind === 'streaming' && turn.text.length === 0)) &&
    showSkeleton
  const showPlaceholder =
    turn.kind === 'pending' && !showSkeleton && !hasStream

  return (
    <View testID={`home-chat-turn-${turn.id}`}>
      <BubbleEnter>
        <View style={[styles.bubbleRow, styles.bubbleRowUser]}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            <Text style={styles.bubbleUserText}>{turn.userText}</Text>
            {turn.kind === 'failed' ? (
              <FailureDot
                onPress={onRetry}
                accessibilityLabel={pickLabel('errorRetry', lang)}
              />
            ) : null}
          </View>
        </View>
      </BubbleEnter>
      {turn.kind !== 'failed' ? (
        <BubbleEnter>
          <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
            <View
              style={[
                styles.bubble,
                styles.bubbleAssistant,
                styles.bubbleAssistantFlexible
              ]}
            >
              {showPlaceholder ? (
                <Text style={styles.bubbleAssistantTextThinking}>
                  {pickLabel('thinking', lang)}
                </Text>
              ) : null}
              {showSkeleton && !hasStream ? <ChatSkeleton /> : null}
              {hasStream ? (
                <Text style={styles.bubbleAssistantText}>{turn.text}</Text>
              ) : null}
              {showPulse ? <ThreeDotPulse /> : null}
              {showSlow ? (
                <Text style={styles.slowIndicator}>
                  {lang === 'sw'
                    ? 'Borjie ana shughuli, jaribu tena…'
                    : 'Borjie is busy, hold on…'}
                </Text>
              ) : null}
            </View>
          </View>
        </BubbleEnter>
      ) : null}
      {turn.toolCalls.map((call, index) => (
        <ToolCallRenderer key={`${turn.id}:tool:${index}`} call={call} />
      ))}
      {turn.proposedAction ? (
        <ProposedActionCard action={turn.proposedAction} lang={lang} />
      ) : null}
    </View>
  )
}

interface BubbleEnterProps {
  readonly children: ReactNode
}

function BubbleEnter({ children }: BubbleEnterProps): JSX.Element {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: ENTRY_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start()
  }, [progress])
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0]
  })
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  )
}

interface CitationChipsProps {
  readonly citations: ReadonlyArray<{
    readonly id: string
    readonly label: string
  }>
}

function CitationChips({ citations }: CitationChipsProps): JSX.Element {
  return (
    <View style={styles.citationRow} testID="home-chat-citations">
      {citations.map((citation, index) => (
        <View key={citation.id} style={styles.citationPill}>
          <Text style={styles.citationText}>
            [{index + 1}] {citation.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

interface ProposedActionCardProps {
  readonly action: NonNullable<SettledTurn['proposedAction']>
  readonly lang: 'sw' | 'en'
}

function ProposedActionCard({
  action,
  lang
}: ProposedActionCardProps): JSX.Element {
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
  const [recording, setRecording] = useState(false)

  const onLongPressVoice = useCallback(() => {
    setRecording(true)
  }, [])
  const onPressOutVoice = useCallback(() => {
    if (recording) {
      setRecording(false)
    }
  }, [recording])

  return (
    <View style={styles.composer} testID="home-chat-composer">
      {recording ? (
        <View style={styles.voiceCue} testID="home-chat-voice-cue">
          <Text style={styles.voiceCueText}>
            {lang === 'sw'
              ? 'Shikilia kuongea • Achia kutuma'
              : 'Hold to speak • Release to send'}
          </Text>
        </View>
      ) : null}
      <View style={styles.composerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pickLabel('attach', lang)}
          style={styles.iconButton}
          hitSlop={6}
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
          style={[styles.iconButton, recording ? styles.iconButtonActive : null]}
          onLongPress={onLongPressVoice}
          onPressOut={onPressOutVoice}
          delayLongPress={300}
          hitSlop={6}
          testID="home-chat-voice"
        >
          <Text style={styles.iconButtonText}>S</Text>
        </Pressable>
        <SendButton
          label={pickLabel('send', lang)}
          accessibilityLabel={pickLabel('send', lang)}
          onPress={onSendPress}
          enabled={canSend}
        />
      </View>
    </View>
  )
}

async function runStream(
  optimistic: LiveTurn,
  threadId: string | null,
  persona: string | undefined,
  onEvent: (turnId: string, event: BrainStreamEvent) => void
): Promise<SettledTurn> {
  let working = optimistic
  const result = await streamBrainTurn({
    userText: optimistic.userText,
    threadId,
    ...(persona !== undefined ? { persona } : {}),
    onEvent: (event) => {
      onEvent(optimistic.id, event)
      if (event.kind === 'accepted' && event.data.type === 'accepted') {
        working = applyTurnAccepted(working, event.data.threadId)
      } else if (
        event.kind === 'message_chunk' &&
        event.data.type === 'message_chunk'
      ) {
        working = applyMessageChunk(working, event.data.delta)
      } else if (event.kind === 'tool_call' && event.data.type === 'tool_call') {
        working = applyToolCall(working, event.data.toolCall)
      } else if (
        event.kind === 'proposed_action' &&
        event.data.type === 'proposed_action'
      ) {
        working = applyProposedAction(working, event.data.action)
      }
    }
  })
  return finaliseTurn(working, result.threadId, result.tokensUsed)
}

// Pure helpers re-exported for tests.
export const __internals__ = Object.freeze({
  storageKey,
  STORAGE_KEY_PREFIX,
  MAX_PERSISTED_TURNS,
  SKELETON_ONSET_MS,
  SLOW_INDICATOR_MS,
  PULSE_GRACE_MS,
  ENTRY_DURATION_MS,
  openersMap: HOME_CHAT_OPENERS,
  newTurnId
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
    backgroundColor: colors.earth700,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderTopWidth: 2,
    borderTopColor: colors.gold,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.22)'
  },
  greetingEyebrow: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4
  },
  greetingDayPart: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    fontStyle: 'italic'
  },
  greetingPrimary: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700',
    lineHeight: fontSize.h3 * 1.3,
    letterSpacing: -0.3,
    marginTop: spacing.sm
  },
  greetingSecondary: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  suggestionsTitle: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
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
    backgroundColor: colors.earth800,
    borderColor: 'rgba(255, 200, 87, 0.40)',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    justifyContent: 'center'
  },
  suggestionChipPressed: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  suggestionText: {
    color: colors.text,
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
    maxWidth: '88%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1
  },
  bubbleUser: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark,
    borderBottomRightRadius: 6,
    position: 'relative'
  },
  bubbleAssistant: {
    backgroundColor: '#11151F',
    borderColor: 'rgba(255, 200, 87, 0.22)',
    borderTopWidth: 2,
    borderTopColor: colors.gold,
    borderBottomLeftRadius: 6
  },
  bubbleAssistantFlexible: {
    minHeight: 48
  },
  bubbleUserText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    lineHeight: 22,
    fontWeight: '600'
  },
  bubbleAssistantText: {
    color: colors.text,
    fontSize: fontSize.body,
    lineHeight: 22
  },
  bubbleAssistantTextThinking: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontStyle: 'italic',
    lineHeight: 22
  },
  slowIndicator: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontStyle: 'italic',
    marginTop: spacing.xs
  },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm
  },
  citationPill: {
    backgroundColor: 'rgba(255, 200, 87, 0.14)',
    borderColor: 'rgba(255, 200, 87, 0.40)',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2
  },
  citationText: {
    color: colors.goldLight,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  composer: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)'
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm
  },
  voiceCue: {
    backgroundColor: 'rgba(255, 200, 87, 0.12)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.32)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm
  },
  voiceCueText: {
    color: colors.gold,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.4
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.earth700,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  iconButtonText: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: colors.earth700,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.body
  },
  proposedActionWrap: {
    backgroundColor: colors.earth700,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.22)'
  },
  proposedActionLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  proposedActionBody: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  proposedActionMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})

// Surface ApiError so callers don't have to walk back through api/errors.
export type HomeChatApiError = ApiError
