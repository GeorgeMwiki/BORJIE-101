/**
 * HomeChat — buyer-mobile chat surface with SSE streaming + R7 polish.
 *
 * R7 changes baked in:
 *   • The permanent `ActivityIndicator` is gone (was an anti-pattern
 *     per R7 §6.2); a `ChatSkeleton` shimmer + `ThreeDotPulse` cover
 *     the wait window. Skeleton onset 200 ms after send, slow indicator
 *     at 3 s, FailureDot on terminal error.
 *   • Optimistic user bubble paints BEFORE the network ack, slides up
 *     200 ms ease-out via `Animated`.
 *   • Auto-scroll only fires when the user is already at the bottom
 *     (within 80 px) — typing while reading earlier turns no longer
 *     yanks the viewport.
 *   • Smart-reply chips appear above the composer after each brain
 *     response, derived from the first tool call's name.
 *   • Citation chips render at the bottom of the assistant bubble.
 *   • Composer NEVER disables during pending — the user can queue
 *     follow-ups; the next mutation waits for the prior to settle.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import { Screen } from '@/components/Screen'
import { useSession } from '@/auth/session'
import { useTranslation } from '@/hooks/useTranslation'
import { ApiError } from '@/api/errors'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import { greet as timeAwareGreeting } from '@/ui-litfin'
import { streamBrainTurn, type BrainStreamEvent } from './brainTurn'
import { ChatSkeleton } from './ChatSkeleton'
import { FailureDot } from './FailureDot'
import { SendButton } from './SendButton'
import { ThreeDotPulse } from './ThreeDotPulse'
import { ToolCallRenderer } from './ToolCallRenderer'
import {
  buyerGreeting,
  buyerSuggestions,
  composerPlaceholder
} from './greeting'
import {
  R7_TIMINGS,
  applyMessageChunk,
  applyStreamError,
  applyToolCall,
  applyTurnAccepted,
  finaliseTurn,
  optimisticTurn,
  shouldAutoScroll,
  smartReplyChips,
  type LiveTurn,
  type SettledTurn
} from './chatTurns'

const SKELETON_ONSET_MS = R7_TIMINGS['SKELETON_ONSET_MS'] ?? 200
const SLOW_INDICATOR_MS = R7_TIMINGS['SLOW_INDICATOR_MS'] ?? 3_000
const ENTRY_DURATION_MS = R7_TIMINGS['BUBBLE_ENTRY_DURATION_MS'] ?? 200

export function HomeChat() {
  const user = useSession()
  const { t, lang } = useTranslation()
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState<readonly SettledTurn[]>([])
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const scrollRef = useRef<ScrollView | null>(null)
  const scrollMetrics = useRef({ y: 0, contentHeight: 0, viewportHeight: 0 })
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showSlow, setShowSlow] = useState(false)

  const suggestions = useMemo(() => buyerSuggestions(lang), [lang])
  const greeting = useMemo(() => buyerGreeting(lang), [lang])
  const placeholder = useMemo(() => composerPlaceholder(lang), [lang])

  const lastToolName = useMemo<string | null>(() => {
    const last = history[history.length - 1]
    if (!last || last.toolCalls.length === 0) {
      return null
    }
    return last.toolCalls[0]?.name ?? null
  }, [history])

  const smartReplies = useMemo(
    () => smartReplyChips(lastToolName, lang),
    [lastToolName, lang]
  )

  // Skeleton onset — 200 ms post send if pending / no chunks yet.
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

  // Slow indicator — 3 s post send (R7 §6.2).
  useEffect(() => {
    if (live === null || live.kind === 'failed') {
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
        return prev
      })
    },
    []
  )

  const safeScrollToEnd = useCallback((): void => {
    const m = scrollMetrics.current
    if (m.contentHeight === 0 || m.viewportHeight === 0) {
      scrollRef.current?.scrollToEnd({ animated: true })
      return
    }
    if (shouldAutoScroll(m.y, m.contentHeight, m.viewportHeight)) {
      scrollRef.current?.scrollToEnd({ animated: true })
    }
  }, [])

  const submitText = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (trimmed.length === 0 || live !== null) {
        return
      }
      const fresh = optimisticTurn(trimmed)
      setLive(fresh)
      setDraft('')
      safeScrollToEnd()
      void runStream(fresh, threadId, handleEvent)
        .then((settled) => {
          setLive(null)
          setHistory((prev) => [...prev, settled])
          setThreadId(settled.threadId)
          setShowSkeleton(false)
          setShowSlow(false)
          safeScrollToEnd()
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
    [handleEvent, live, threadId, safeScrollToEnd]
  )

  const retry = useCallback(
    (failed: LiveTurn): void => {
      if (failed.kind !== 'failed') {
        return
      }
      setLive(null)
      submitText(failed.userText)
    },
    [submitText]
  )

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const e = event.nativeEvent
      scrollMetrics.current = {
        y: e.contentOffset.y,
        contentHeight: e.contentSize.height,
        viewportHeight: e.layoutMeasurement.height
      }
    },
    []
  )

  const showGreeting = history.length === 0 && live === null

  return (
    <Screen scroll={false} padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={64}
        >
          {showGreeting ? (
            <View style={styles.greetingBlock}>
              <Text style={styles.greetingEyebrow}>MR. MWIKILA · MARKETPLACE DIRECTOR</Text>
              <Text style={styles.greetingTitle}>
                {timeAwareGreeting(lang, user.companyName)}
              </Text>
              <Text style={styles.greetingBody}>{greeting}</Text>
              <View style={styles.chipRow}>
                {suggestions.map((sug) => (
                  <Pressable
                    key={sug.id}
                    onPress={() => submitText(sug.prompt)}
                    style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                  >
                    <Text style={styles.chipLabel}>{sug.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {history.map((turn) => (
            <SettledTurnView key={turn.id} turn={turn} translate={t} />
          ))}

          {live !== null ? (
            <LiveTurnView
              turn={live}
              lang={lang}
              showSkeleton={showSkeleton}
              showSlow={showSlow}
              translate={t}
              onRetry={() => retry(live)}
            />
          ) : null}
        </ScrollView>

        {smartReplies.length > 0 && live === null ? (
          <View style={styles.smartReplyRow} testID="buyer-chat-smart-replies">
            {smartReplies.map((chip) => (
              <Pressable
                key={chip.id}
                onPress={() => setDraft(chip.prompt)}
                style={({ pressed }) => [
                  styles.smartReplyChip,
                  pressed && styles.chipPressed
                ]}
                testID={`buyer-chat-smart-reply-${chip.id}`}
              >
                <Text style={styles.smartReplyLabel}>{chip.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            multiline
            blurOnSubmit
            testID="buyer-chat-input"
          />
          <SendButton
            label={t('chat.send')}
            accessibilityLabel={t('chat.send')}
            onPress={() => submitText(draft)}
            enabled={draft.trim().length > 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

interface SettledTurnViewProps {
  readonly turn: SettledTurn
  readonly translate: (key: string) => string
}

function SettledTurnView({ turn, translate }: SettledTurnViewProps) {
  return (
    <View style={styles.turnBlock}>
      <BubbleEnter>
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleUserText}>{turn.userText}</Text>
        </View>
      </BubbleEnter>
      <BubbleEnter>
        {turn.responseText.length > 0 ? (
          <View style={[styles.bubble, styles.bubbleBrain]}>
            <Text style={styles.bubbleBrainText}>{turn.responseText}</Text>
            {turn.citations.length > 0 ? (
              <CitationChips citations={turn.citations} />
            ) : null}
          </View>
        ) : null}
      </BubbleEnter>
      {turn.toolCalls.length > 0 ? (
        <ToolCallRenderer toolCalls={turn.toolCalls} translate={translate} />
      ) : null}
    </View>
  )
}

interface LiveTurnViewProps {
  readonly turn: LiveTurn
  readonly lang: 'sw' | 'en'
  readonly showSkeleton: boolean
  readonly showSlow: boolean
  readonly translate: (key: string) => string
  readonly onRetry: () => void
}

function LiveTurnView({
  turn,
  lang,
  showSkeleton,
  showSlow,
  translate,
  onRetry
}: LiveTurnViewProps) {
  const hasStream = turn.kind === 'streaming' && turn.text.length > 0
  const showPulse =
    (turn.kind === 'pending' ||
      (turn.kind === 'streaming' && turn.text.length === 0)) &&
    showSkeleton

  return (
    <View style={styles.turnBlock}>
      <BubbleEnter>
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleUserText}>{turn.userText}</Text>
          {turn.kind === 'failed' ? (
            <FailureDot
              onPress={onRetry}
              accessibilityLabel={lang === 'sw' ? 'Jaribu tena' : 'Try again'}
            />
          ) : null}
        </View>
      </BubbleEnter>
      {turn.kind !== 'failed' ? (
        <BubbleEnter>
          <View style={[styles.bubble, styles.bubbleBrain, styles.bubbleBrainFlexible]}>
            {showSkeleton && !hasStream ? <ChatSkeleton /> : null}
            {hasStream ? (
              <Text style={styles.bubbleBrainText}>{turn.text}</Text>
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
        </BubbleEnter>
      ) : null}
      {turn.toolCalls.length > 0 ? (
        <ToolCallRenderer toolCalls={turn.toolCalls} translate={translate} />
      ) : null}
    </View>
  )
}

interface BubbleEnterProps {
  readonly children: ReactNode
}

function BubbleEnter({ children }: BubbleEnterProps) {
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
  readonly citations: ReadonlyArray<{ readonly id: string; readonly label: string }>
}

function CitationChips({ citations }: CitationChipsProps) {
  return (
    <View style={styles.citationRow} testID="buyer-chat-citations">
      {citations.map((citation, index) => (
        <View key={citation.id} style={styles.citationPill}>
          <Text style={styles.citationText}>[{index + 1}] {citation.label}</Text>
        </View>
      ))}
    </View>
  )
}

async function runStream(
  optimistic: LiveTurn,
  threadId: string | null,
  onEvent: (turnId: string, event: BrainStreamEvent) => void
): Promise<SettledTurn> {
  let working = optimistic
  const result = await streamBrainTurn({
    userText: optimistic.userText,
    threadId,
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
      }
    }
  })
  return finaliseTurn(working, result.threadId, result.tokensUsed)
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md
  },
  greetingBlock: {
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: 20,
    backgroundColor: colors.forestSoft,
    borderTopWidth: 2,
    borderTopColor: colors.gold,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.22)'
  },
  greetingEyebrow: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  greetingTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.cream,
    letterSpacing: -0.6,
    marginTop: spacing.sm
  },
  greetingBody: {
    ...typography.body,
    color: colors.sand,
    marginTop: spacing.sm,
    lineHeight: 22
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.forest,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.40)',
    minHeight: 40,
    justifyContent: 'center'
  },
  chipPressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
  chipLabel: { ...typography.bodyStrong, color: colors.cream },
  smartReplyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  smartReplyChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255, 200, 87, 0.10)',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.32)',
    minHeight: 36
  },
  smartReplyLabel: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '700'
  },
  turnBlock: {
    gap: spacing.sm
  },
  bubble: {
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    maxWidth: '88%',
    position: 'relative',
    borderWidth: 1
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.gold,
    borderColor: colors.goldSoft,
    borderBottomRightRadius: 6
  },
  bubbleUserText: { ...typography.body, color: colors.ink, fontWeight: '600' },
  bubbleBrain: {
    alignSelf: 'flex-start',
    backgroundColor: colors.forestSoft,
    borderColor: 'rgba(255, 200, 87, 0.22)',
    borderTopWidth: 2,
    borderTopColor: colors.gold,
    borderBottomLeftRadius: 6
  },
  bubbleBrainFlexible: {
    minHeight: 48,
    minWidth: 120
  },
  bubbleBrainText: { ...typography.body, color: colors.cream, lineHeight: 22 },
  slowIndicator: {
    ...typography.caption,
    color: colors.sand,
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
    ...typography.caption,
    color: colors.gold,
    fontWeight: '700'
  },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: colors.forest,
    alignItems: 'flex-end'
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.forestSoft,
    color: colors.cream,
    minHeight: 48,
    maxHeight: 140,
    textAlignVertical: 'top',
    ...typography.body
  }
})
