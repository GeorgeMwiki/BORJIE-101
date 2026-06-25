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
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData
} from 'react-native'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n/useI18n'
import { pickStrings } from '../i18n'
import { ApiError } from '../api/errors'
import { enqueueWrite } from '../sync/queue'
import { resolveWorkforcePersona, workforcePersonaSpec } from '../roles/persona'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { greet } from '../ui-litfin'
import { usePhotoPicker, type CapturedMedia } from '../media/usePhotoPicker'
// Wave WORKFORCE-FIXED-TABS — workers cannot mutate tabs locally. When
// the brain detects a tab/access-change intent we open the request
// sheet instead of opening a brain stream. The sheet posts to
// /api/v1/workforce/tab-change-requests for owner approval.
import { detectTabChangeIntent } from '../lib/tabChangeIntent'
import { useWorkforceTabConfig } from '../lib/hooks/useWorkforceTabConfig'
import { RequestTabChangeSheet } from '../components/RequestTabChangeSheet'
import {
  slashCommandsForPersona,
  type WorkforceRoleId
} from '@borjie/persona-runtime'
import { streamBrainTurn, type BrainStreamEvent } from './brainTurn'
import { confirmAction } from './chatActions'
import {
  buildConfirmRequest,
  buildFulfillmentTurn,
  interpretResult,
  type FulfillmentOutcome
} from './actionFulfillment'
import {
  applySelection,
  filterEntities,
  filterSlashCommands,
  parseTrigger,
  type EntityItem,
  type SlashCommandItem
} from './composer-triggers'
import { SlashMenu, AtMenu } from './ComposerMenu'
import { fetchRecentEntities } from './recentEntities'
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
  shouldAutoScroll,
  smartReplyChips,
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
  // Wave WORKFORCE-FIXED-TABS — sheet state + current tab snapshot.
  const tabConfig = useWorkforceTabConfig()
  const [tabSheetVisible, setTabSheetVisible] = useState<boolean>(false)
  const [tabSheetReasonSeed, setTabSheetReasonSeed] = useState<string>('')
  const workforceRoleId: WorkforceRoleId =
    (tabConfig.config?.role as WorkforceRoleId | undefined) ??
    (role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : 'pit_operator')

  // Persona resolution: prefer the fine-grained tab-config role (8
  // workforce roles). Falls back through the safe supervisor persona
  // when the tab-config has not hydrated. The legacy 3-role mapping
  // remains for the dev-mode role picker.
  const personaSlug = useMemo(
    () =>
      resolveWorkforcePersona({
        tabConfigRole: tabConfig.config?.role as WorkforceRoleId | undefined,
        legacyRole: role
      }),
    [role, tabConfig.config?.role]
  )
  // Keep the legacy 3-role spec around for places that still read it.
  void workforcePersonaSpec

  const [turns, setTurns] = useState<ReadonlyArray<SettledTurn>>([])
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [caret, setCaret] = useState<number>(0)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [pendingAttachment, setPendingAttachment] = useState<CapturedMedia | null>(null)
  const scrollRef = useRef<ScrollView | null>(null)
  const scrollMetrics = useRef({ y: 0, contentHeight: 0, viewportHeight: 0 })
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showSlow, setShowSlow] = useState(false)
  const photoPicker = usePhotoPicker()

  // Smart-reply chips — LitFin parity. Derived from the last settled
  // turn's first tool call so the worker gets one-tap follow-ups.
  const lastToolName = useMemo<string | null>(() => {
    const last = turns[turns.length - 1]
    if (!last || last.toolCalls.length === 0) {
      return null
    }
    return last.toolCalls[0]?.tool ?? null
  }, [turns])
  const smartReplies = useMemo(
    () => smartReplyChips(lastToolName, lang),
    [lastToolName, lang]
  )

  // Composer slash + @ menus — load slash commands per persona once,
  // fetch @-entities lazily when the trigger opens.
  const slashCatalog = useMemo<ReadonlyArray<SlashCommandItem>>(
    () => slashCommandsForPersona(personaSlug, 'workforce'),
    [personaSlug]
  )
  const [atEntities, setAtEntities] = useState<ReadonlyArray<EntityItem>>([])

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
      // Wave WORKFORCE-FIXED-TABS — intercept tab/access-change intent
      // BEFORE opening a brain stream. Routes the request through the
      // owner-approval sheet instead of letting the brain promise a
      // change it cannot make. The brain prompt has matching guard.
      const intent = detectTabChangeIntent(trimmed, lang)
      if (intent) {
        setTabSheetReasonSeed(intent.reasonSeed)
        setTabSheetVisible(true)
        setDraft('')
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
    [handleEvent, lang, live, personaSlug, threadId]
  )

  const onAttachPress = useCallback((): void => {
    void photoPicker.pickPhoto().then((media) => {
      if (media !== null) {
        setPendingAttachment(media)
      }
    })
  }, [photoPicker])

  const onSendPress = useCallback((): void => {
    // Enqueue the attachment BEFORE clearing it so the offline sync
    // queue carries the media even if the brain turn fails.
    // The attachment is keyed to the current threadId so the brain
    // can correlate it with the next turn's context once the
    // media-turn pipeline is wired on the gateway side.
    if (pendingAttachment !== null) {
      void enqueueWrite('photo_upload', {
        uri: pendingAttachment.uri,
        capturedAt: pendingAttachment.capturedAt,
        mimeType: pendingAttachment.mimeType,
        threadId,
        userId: user?.id ?? null,
        at: Date.now()
      })
    }
    submitTurn(draft)
    setPendingAttachment(null)
  }, [draft, pendingAttachment, submitTurn, threadId, user?.id])

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

  // Safe auto-scroll — LitFin parity. Only snap to bottom when the user
  // is already near it, so reading earlier turns is never yanked.
  const onContentSizeChange = useCallback((): void => {
    const m = scrollMetrics.current
    if (m.contentHeight === 0 || m.viewportHeight === 0) {
      scrollRef.current?.scrollToEnd({ animated: true })
      return
    }
    if (shouldAutoScroll(m.y, m.contentHeight, m.viewportHeight)) {
      scrollRef.current?.scrollToEnd({ animated: true })
    }
  }, [])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const e = event.nativeEvent
      scrollMetrics.current = {
        y: e.contentOffset.y,
        contentHeight: e.contentSize.height,
        viewportHeight: e.layoutMeasurement.height
      }
    },
    []
  )

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

  // Trigger probe — recomputed each render from draft + caret.
  const trigger = useMemo(
    () => parseTrigger(draft, caret),
    [draft, caret]
  )

  // Filtered menu rows by locale + persona.
  const filteredSlashCommands = useMemo<ReadonlyArray<SlashCommandItem>>(
    () =>
      trigger.kind === 'slash'
        ? filterSlashCommands(slashCatalog, trigger.query, {
            personaSlug,
            locale: lang
          })
        : [],
    [trigger, slashCatalog, personaSlug, lang]
  )
  const filteredEntities = useMemo<ReadonlyArray<EntityItem>>(
    () =>
      trigger.kind === 'at'
        ? filterEntities(atEntities, trigger.query, { locale: lang })
        : [],
    [trigger, atEntities, lang]
  )

  // Lazy fetch entities the first time `@` opens.
  useEffect(() => {
    if (trigger.kind !== 'at' || atEntities.length > 0) {
      return
    }
    let cancelled = false
    void fetchRecentEntities('scope_node', 20).then((rows) => {
      if (!cancelled) setAtEntities(rows)
    })
    return () => {
      cancelled = true
    }
  }, [trigger.kind, atEntities.length])

  const onSelectSlash = useCallback(
    (cmd: SlashCommandItem): void => {
      const next = applySelection(
        { text: draft, caret },
        trigger,
        { token: `/${cmd.id}` }
      )
      setDraft(next.text)
      setCaret(next.caret)
    },
    [caret, draft, trigger]
  )
  const onSelectEntity = useCallback(
    (entity: EntityItem): void => {
      const next = applySelection(
        { text: draft, caret },
        trigger,
        { token: `@${entity.id}` }
      )
      setDraft(next.text)
      setCaret(next.caret)
    },
    [caret, draft, trigger]
  )

  const showGreeting = turns.length === 0 && live === null
  const canSend = draft.trim().length > 0

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="home-chat-root"
    >
      <ScrollView
        ref={scrollRef}
        style={styles.history}
        contentContainerStyle={styles.historyContent}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
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
          <SettledTurnView key={turn.id} turn={turn} onFulfill={submitTurn} />
        ))}
        {live !== null ? (
          <LiveTurnView
            turn={live}
            lang={lang}
            showSkeleton={showSkeleton}
            showSlow={showSlow}
            pulseGraceMs={PULSE_GRACE_MS}
            onRetry={() => retryFailedTurn(live)}
            onFulfill={submitTurn}
          />
        ) : null}
      </ScrollView>
      {smartReplies.length > 0 && live === null ? (
        <View style={styles.smartReplyRow} testID="home-chat-smart-replies">
          {smartReplies.map((chip) => (
            <Pressable
              key={chip.id}
              onPress={() => setDraft(chip.prompt)}
              accessibilityRole="button"
              accessibilityLabel={chip.label}
              testID={`home-chat-smart-reply-${chip.id}`}
              style={({ pressed }) => [
                styles.smartReplyChip,
                pressed ? styles.smartReplyChipPressed : null
              ]}
            >
              <Text style={styles.smartReplyLabel}>{chip.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Composer
        draft={draft}
        onChangeDraft={setDraft}
        onSelectionChange={setCaret}
        onSubmit={onSubmitEditing}
        onSendPress={onSendPress}
        canSend={canSend}
        lang={lang}
        triggerKind={trigger.kind}
        slashRows={filteredSlashCommands}
        atRows={filteredEntities}
        onSelectSlash={onSelectSlash}
        onSelectEntity={onSelectEntity}
        onAttachPress={onAttachPress}
        pendingAttachment={pendingAttachment}
      />
      <RequestTabChangeSheet
        visible={tabSheetVisible}
        onClose={() => setTabSheetVisible(false)}
        role={workforceRoleId}
        siteId={
          tabConfig.config?.siteScope &&
          tabConfig.config.siteScope !== 'global'
            ? tabConfig.config.siteScope
            : null
        }
        currentTabs={tabConfig.tabs}
        initialReason={tabSheetReasonSeed}
      />
    </KeyboardAvoidingView>
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

interface SettledTurnViewProps {
  readonly turn: SettledTurn
  readonly onFulfill: (text: string) => void
}

function SettledTurnView({ turn, onFulfill }: SettledTurnViewProps): JSX.Element {
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
        <ProposedActionCard
          action={turn.proposedAction}
          lang={lang}
          onFulfill={onFulfill}
        />
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
  readonly onFulfill: (text: string) => void
}

function LiveTurnView({
  turn,
  lang,
  showSkeleton,
  showSlow,
  pulseGraceMs,
  onRetry,
  onFulfill
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
                  {pickStrings(lang).composer.busy}
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
        <ProposedActionCard
          action={turn.proposedAction}
          lang={lang}
          onFulfill={onFulfill}
        />
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
  readonly onFulfill: (text: string) => void
}

type ActionPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'settled'; readonly outcome: FulfillmentOutcome }

/**
 * ProposedActionCard — the brain proposes an action; the worker / owner
 * acts on it here. Tapping Approve POSTs `{ verb, params }` (derived
 * generically from the card — no per-verb switch) to the SAME generative
 * fulfillment endpoint owner-web uses and consumes the `{ executed,
 * authorized, reason, deferToBrain }` envelope IDENTICALLY:
 *   executed     → success note · deferToBrain → "Borjie is handling it"
 *   + a structured fulfillment turn to the brain · !authorized → "needs
 *   confirmation" · error/declined → inline note. The outcome renders
 *   inline; the Approve button hides once the action has been taken.
 */
function ProposedActionCard({
  action,
  lang,
  onFulfill
}: ProposedActionCardProps): JSX.Element {
  const [phase, setPhase] = useState<ActionPhase>({ kind: 'idle' })

  const riskKey =
    action.riskLevel === 'CRITICAL'
      ? 'riskCritical'
      : action.riskLevel === 'HIGH'
        ? 'riskHigh'
        : action.riskLevel === 'MEDIUM'
          ? 'riskMedium'
          : 'riskLow'

  const onApprove = useCallback((): void => {
    setPhase({ kind: 'running' })
    void confirmAction(buildConfirmRequest(action))
      .then((result) => {
        const outcome = interpretResult(action, result)
        setPhase({ kind: 'settled', outcome })
        // deferToBrain — the brain that emitted this dynamic verb fulfills
        // it agentically. Submit a structured fulfillment turn (mirrors
        // owner-web's `onSuggestion(buildFulfillmentTurn(...))`).
        if (outcome.kind === 'deferToBrain') {
          onFulfill(buildFulfillmentTurn(outcome.verb, outcome.params, lang))
        }
      })
      .catch(() => {
        setPhase({
          kind: 'settled',
          outcome: { kind: 'declined' }
        })
      })
  }, [action, lang, onFulfill])

  return (
    <View style={styles.proposedActionWrap} testID="home-chat-proposed-action">
      <Text style={styles.proposedActionLabel}>
        {pickLabel('proposedAction', lang)}
      </Text>
      <Text style={styles.proposedActionBody}>
        {action.verb} · {action.object}
      </Text>
      <Text style={styles.proposedActionMeta}>{pickLabel(riskKey, lang)}</Text>
      {phase.kind === 'settled' ? (
        <ActionOutcomeNote outcome={phase.outcome} lang={lang} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pickLabel('actionApprove', lang)}
          disabled={phase.kind === 'running'}
          onPress={onApprove}
          testID="home-chat-proposed-action-approve"
          style={({ pressed }) => [
            styles.proposedActionApprove,
            pressed ? styles.proposedActionApprovePressed : null,
            phase.kind === 'running' ? styles.proposedActionApproveBusy : null
          ]}
        >
          <Text style={styles.proposedActionApproveText}>
            {phase.kind === 'running'
              ? pickLabel('actionRunning', lang)
              : pickLabel('actionApprove', lang)}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

interface ActionOutcomeNoteProps {
  readonly outcome: FulfillmentOutcome
  readonly lang: 'sw' | 'en'
}

function ActionOutcomeNote({
  outcome,
  lang
}: ActionOutcomeNoteProps): JSX.Element {
  const { text, tone } = describeOutcome(outcome, lang)
  return (
    <View
      style={[
        styles.actionOutcome,
        tone === 'success'
          ? styles.actionOutcomeSuccess
          : tone === 'pending'
            ? styles.actionOutcomePending
            : styles.actionOutcomeWarn
      ]}
      testID="home-chat-proposed-action-outcome"
    >
      <Text style={styles.actionOutcomeText}>{text}</Text>
    </View>
  )
}

type OutcomeTone = 'success' | 'pending' | 'warn'

function describeOutcome(
  outcome: FulfillmentOutcome,
  lang: 'sw' | 'en'
): { readonly text: string; readonly tone: OutcomeTone } {
  if (outcome.kind === 'executed') {
    return { text: pickLabel('actionExecuted', lang), tone: 'success' }
  }
  if (outcome.kind === 'deferToBrain') {
    return { text: pickLabel('actionHandling', lang), tone: 'pending' }
  }
  if (outcome.kind === 'needsConfirmation') {
    return {
      text: `${pickLabel('actionNeedsConfirmation', lang)} — ${outcome.reason}`,
      tone: 'warn'
    }
  }
  // declined — show the reason when the bridge supplied one, else the
  // generic error copy so the note is never empty.
  return {
    text:
      outcome.reason !== undefined
        ? `${pickLabel('actionDeclined', lang)} — ${outcome.reason}`
        : pickLabel('actionError', lang),
    tone: 'warn'
  }
}

interface ComposerProps {
  readonly draft: string
  readonly onChangeDraft: (next: string) => void
  readonly onSelectionChange: (caret: number) => void
  readonly onSubmit: (
    event: NativeSyntheticEvent<TextInputSubmitEditingEventData>
  ) => void
  readonly onSendPress: () => void
  readonly canSend: boolean
  readonly lang: 'sw' | 'en'
  readonly triggerKind: 'slash' | 'at' | 'none'
  readonly slashRows: ReadonlyArray<SlashCommandItem>
  readonly atRows: ReadonlyArray<EntityItem>
  readonly onSelectSlash: (cmd: SlashCommandItem) => void
  readonly onSelectEntity: (entity: EntityItem) => void
  /** Open the image/media picker. Called when the user taps `+`. */
  readonly onAttachPress: () => void
  /** Non-null while a picked attachment is pending confirmation. */
  readonly pendingAttachment: CapturedMedia | null
}

function Composer({
  draft,
  onChangeDraft,
  onSelectionChange,
  onSubmit,
  onSendPress,
  canSend,
  lang,
  triggerKind,
  slashRows,
  atRows,
  onSelectSlash,
  onSelectEntity,
  onAttachPress,
  pendingAttachment
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
      {triggerKind === 'slash' ? (
        <SlashMenu commands={slashRows} locale={lang} onSelect={onSelectSlash} />
      ) : null}
      {triggerKind === 'at' ? (
        <AtMenu entities={atRows} locale={lang} onSelect={onSelectEntity} />
      ) : null}
      {recording ? (
        <View style={styles.voiceCue} testID="home-chat-voice-cue">
          <Text style={styles.voiceCueText}>
            {pickStrings(lang).composer.voiceCue}
          </Text>
        </View>
      ) : null}
      {pendingAttachment !== null ? (
        <View style={styles.attachmentPill} testID="home-chat-attachment-pending">
          <Text style={styles.attachmentPillText}>
            {pickStrings(lang).composer.attachmentPending}
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
          onPress={onAttachPress}
        >
          <Text style={styles.iconButtonText}>+</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          onSelectionChange={(event) =>
            onSelectionChange(event.nativeEvent.selection.end)
          }
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
  newTurnId,
  smartReplyChips,
  shouldAutoScroll
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
  smartReplyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.sm
  },
  smartReplyChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255, 200, 87, 0.10)',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.32)',
    minHeight: 36,
    justifyContent: 'center'
  },
  smartReplyChipPressed: {
    backgroundColor: 'rgba(255, 200, 87, 0.20)'
  },
  smartReplyLabel: {
    color: colors.gold,
    fontSize: fontSize.caption,
    fontWeight: '700'
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
  },
  proposedActionApprove: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: colors.goldDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md
  },
  proposedActionApprovePressed: {
    backgroundColor: colors.goldDark
  },
  proposedActionApproveBusy: {
    opacity: 0.7
  },
  proposedActionApproveText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700',
    letterSpacing: 0.3
  },
  actionOutcome: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  actionOutcomeSuccess: {
    backgroundColor: 'rgba(120, 200, 120, 0.12)',
    borderColor: 'rgba(120, 200, 120, 0.40)'
  },
  actionOutcomePending: {
    backgroundColor: 'rgba(255, 200, 87, 0.12)',
    borderColor: 'rgba(255, 200, 87, 0.40)'
  },
  actionOutcomeWarn: {
    backgroundColor: 'rgba(255, 140, 90, 0.12)',
    borderColor: 'rgba(255, 140, 90, 0.40)'
  },
  actionOutcomeText: {
    color: colors.text,
    fontSize: fontSize.caption,
    fontWeight: '600',
    lineHeight: 18
  },
  attachmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 200, 87, 0.12)',
    borderColor: 'rgba(255, 200, 87, 0.40)',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
    alignSelf: 'flex-start'
  },
  attachmentPillText: {
    color: colors.gold,
    fontSize: fontSize.caption,
    fontWeight: '600'
  }
})

// Surface ApiError so callers don't have to walk back through api/errors.
export type HomeChatApiError = ApiError
