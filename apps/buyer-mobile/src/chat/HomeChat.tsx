import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useSession } from '@/auth/session'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import { postBrainTurn } from './brainTurn'
import { ToolCallRenderer } from './ToolCallRenderer'
import {
  buyerGreeting,
  buyerSuggestions,
  composerPlaceholder,
  errorLabel,
  loadingLabel
} from './greeting'
import { fail, settle } from './historyReducer'
import type { ChatTurn } from './types'

// Buyer-mobile home is a chat surface. The user types (or taps a chip),
// `/api/v1/brain/turn` returns text + tool calls, the renderer maps each
// tool call to an inline buyer-context card (listings, lobby, bids, KYC,
// bid recommendation, deal pipeline). The composer + history are the
// only persistent UI — no marketplace filter bar, no parcel feed unless
// the brain renders one inline.

export function HomeChat() {
  const user = useSession()
  const { t, lang } = useTranslation()
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState<readonly ChatTurn[]>([])
  const [threadId, setThreadId] = useState<string | undefined>(undefined)
  const scrollRef = useRef<ScrollView | null>(null)

  const mutation = useMutation({
    mutationFn: postBrainTurn,
    onSuccess: (response, variables) => {
      setThreadId(response.threadId)
      setHistory((prev) => settle(prev, variables.userText, response))
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
    },
    onError: (_error, variables) => {
      setHistory((prev) => fail(prev, variables.userText, errorLabel(lang)))
    }
  })

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed.length === 0 || mutation.isPending) {
        return
      }
      const optimistic: ChatTurn = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        pending: true,
        createdAt: new Date().toISOString()
      }
      setHistory((prev) => [...prev, optimistic])
      setDraft('')
      mutation.mutate({ userText: trimmed, threadId })
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
    },
    [lang, mutation, threadId]
  )

  const suggestions = useMemo(() => buyerSuggestions(lang), [lang])
  const greeting = useMemo(() => buyerGreeting(lang), [lang])
  const placeholder = useMemo(() => composerPlaceholder(lang), [lang])
  const loadingText = useMemo(() => loadingLabel(lang), [lang])
  const showGreeting = history.length === 0

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
        >
          {showGreeting ? (
            <View style={styles.greetingBlock}>
              <Text style={styles.greetingTitle}>{user.companyName || t('app.name')}</Text>
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
            <TurnView key={turn.id} turn={turn} translate={t} />
          ))}

          {mutation.isPending ? (
            <View style={styles.pending}>
              <ActivityIndicator color={colors.forest} />
              <Text style={styles.pendingText}>{loadingText}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            multiline
            blurOnSubmit
          />
          <PrimaryButton
            label={t('chat.send')}
            onPress={() => submitText(draft)}
            disabled={mutation.isPending || draft.trim().length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

interface TurnViewProps {
  readonly turn: ChatTurn
  readonly translate: (key: string) => string
}

function TurnView({ turn, translate }: TurnViewProps) {
  if (turn.role === 'user') {
    return (
      <View style={[styles.bubble, styles.bubbleUser]}>
        <Text style={styles.bubbleUserText}>{turn.text}</Text>
      </View>
    )
  }
  if (turn.role === 'system') {
    return (
      <Card>
        <View style={styles.systemRow}>
          <Pill label="!" tone="danger" />
          <Text style={styles.systemText}>{turn.text}</Text>
        </View>
      </Card>
    )
  }
  return (
    <View style={styles.brainBlock}>
      {turn.text.length > 0 ? (
        <View style={[styles.bubble, styles.bubbleBrain]}>
          <Text style={styles.bubbleBrainText}>{turn.text}</Text>
        </View>
      ) : null}
      {turn.toolCalls && turn.toolCalls.length > 0 ? (
        <ToolCallRenderer toolCalls={turn.toolCalls} translate={translate} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md
  },
  greetingBlock: { marginBottom: spacing.md },
  greetingTitle: { ...typography.display, color: colors.ink },
  greetingBody: { ...typography.body, color: colors.inkSoft, marginTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.cream,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line
  },
  chipPressed: { opacity: 0.7 },
  chipLabel: { ...typography.bodyStrong, color: colors.earth },
  bubble: { padding: spacing.md, borderRadius: radius.lg, maxWidth: '85%' },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.forest },
  bubbleUserText: { ...typography.body, color: colors.bone },
  bubbleBrain: { alignSelf: 'flex-start', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  bubbleBrainText: { ...typography.body, color: colors.ink },
  brainBlock: { gap: spacing.sm },
  pending: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  pendingText: { ...typography.caption, color: colors.inkMuted },
  systemRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  systemText: { ...typography.body, color: colors.danger, flex: 1 },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bone,
    alignItems: 'flex-end'
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    minHeight: 48,
    maxHeight: 140,
    textAlignVertical: 'top',
    ...typography.body
  }
})
