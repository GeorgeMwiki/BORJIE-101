import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import { useTranslation } from '@/hooks/useTranslation'
import { askSession, createSession, summariseDocument } from './api'
import type { UploadedDocument } from './types'
import { ingestionStatusLabel, kindLabel } from './types'

interface ChatTurn {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export interface DocumentExplorerProps {
  readonly document: UploadedDocument
  readonly initialPrompt?: string
}

/**
 * DocumentExplorer (buyer-mobile) — single-doc chat + preview. Mirrors
 * the workforce-mobile component contract but uses the buyer-mobile
 * theme tokens.
 */
export function DocumentExplorer({ document, initialPrompt }: DocumentExplorerProps) {
  const { t, lang } = useTranslation()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turns, setTurns] = useState<ReadonlyArray<ChatTurn>>([])
  const [draft, setDraft] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    if (document.ingestionStatus === 'ready') {
      summariseDocument({ documentId: document.id, language: lang })
        .then((res) => setSummary(res.summary))
        .catch(() => undefined)
    }
  }, [document.id, document.ingestionStatus, lang])

  async function ensureSession(): Promise<string> {
    if (sessionId) {
      return sessionId
    }
    const { sessionId: newId } = await createSession({
      documentIds: [document.id],
      initialPrompt,
      title: `Chat: ${document.fileName}`,
    })
    setSessionId(newId)
    return newId
  }

  async function handleSend(): Promise<void> {
    const question = draft.trim()
    if (question.length === 0 || busy) {
      return
    }
    setBusy(true)
    setError(null)
    const userTurn: ChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: question,
    }
    setTurns((prev) => [...prev, userTurn])
    setDraft('')
    try {
      const id = await ensureSession()
      const res = await askSession({ sessionId: id, question, language: lang })
      const assistantText =
        res.answer ??
        t('documents_intel.answer_pending', { count: res.evidenceIds.length })
      const assistantTurn: ChatTurn = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: assistantText,
      }
      setTurns((prev) => [...prev, assistantTurn])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('documents_intel.ask_failed')
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.fileName} numberOfLines={2}>
          {document.fileName}
        </Text>
        <View style={styles.chipRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{kindLabel(document.kind, t)}</Text>
          </View>
          <View
            style={[
              styles.chip,
              document.ingestionStatus === 'ready' ? styles.chipReady : null,
              document.ingestionStatus === 'failed' ? styles.chipFailed : null,
            ]}
          >
            <Text style={styles.chipText}>{ingestionStatusLabel(document.ingestionStatus, t)}</Text>
          </View>
        </View>
      </View>

      {summary ? (
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>{t('documents_intel.summary')}</Text>
          <Text style={styles.summaryBody} numberOfLines={6}>
            {summary}
          </Text>
        </View>
      ) : null}

      <ScrollView style={styles.chatList} contentContainerStyle={styles.chatContent}>
        {turns.length === 0 ? (
          <Text style={styles.empty}>{t('documents_intel.ask_empty')}</Text>
        ) : (
          turns.map((turn) => (
            <View
              key={turn.id}
              style={[
                styles.bubble,
                turn.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  turn.role === 'user' ? styles.bubbleTextUser : null,
                ]}
              >
                {turn.text}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel={t('documents_intel.ask_accessibility')}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('documents_intel.ask_placeholder')}
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          editable={!busy}
          multiline
        />
        <View style={styles.sendButton}>
          {busy ? (
            <ActivityIndicator color={colors.gold} />
          ) : (
            <Text
              accessibilityRole="button"
              accessibilityLabel={t('documents_intel.send_question')}
              onPress={handleSend}
              style={styles.sendLabel}
            >
              {t('chat.send')}
            </Text>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  fileName: {
    ...typography.heading,
    color: colors.ink,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chip: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.sand,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipReady: {
    backgroundColor: '#DCEEDC',
    borderColor: colors.success,
  },
  chipFailed: {
    backgroundColor: '#F4D7D7',
    borderColor: '#9E2A2B',
  },
  chipText: {
    ...typography.micro,
    color: colors.ink,
  },
  summary: {
    padding: spacing.md,
    margin: spacing.lg,
    backgroundColor: colors.cream,
    borderRadius: radius.md,
  },
  summaryTitle: {
    ...typography.bodyStrong,
    color: colors.ink,
  },
  summaryBody: {
    ...typography.body,
    color: colors.inkSoft,
    marginTop: spacing.xs,
  },
  chatList: {
    flex: 1,
  },
  chatContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  empty: {
    textAlign: 'center',
    color: colors.inkMuted,
    marginTop: spacing.xl,
  },
  bubble: {
    padding: spacing.md,
    borderRadius: radius.md,
    maxWidth: '85%',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.forest,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.sand,
  },
  bubbleText: {
    ...typography.body,
    color: colors.ink,
  },
  bubbleTextUser: {
    color: colors.bone,
  },
  errorBanner: {
    backgroundColor: '#F4D7D7',
    color: '#9E2A2B',
    padding: spacing.sm,
    margin: spacing.md,
    borderRadius: radius.sm,
    ...typography.caption,
  },
  composer: {
    flexDirection: 'row',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: colors.sand,
    borderRadius: radius.md,
    padding: spacing.sm,
    ...typography.body,
    color: colors.ink,
    maxHeight: 120,
  },
  sendButton: {
    padding: spacing.sm,
    backgroundColor: colors.forest,
    borderRadius: radius.md,
    minWidth: 64,
    alignItems: 'center',
  },
  sendLabel: {
    color: colors.gold,
    ...typography.bodyStrong,
  },
})
