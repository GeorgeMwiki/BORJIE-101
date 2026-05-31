import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { askSession, createSession, summariseDocument } from './api'
import type { UploadedDocument } from './types'
import { ingestionStatusLabel, kindLabel } from './types'

interface ChatTurn {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export interface DocumentExplorerProps {
  /** Document being explored — single-doc binding for the chat session. */
  readonly document: UploadedDocument
  /** Optional initial assistant prompt. */
  readonly initialPrompt?: string
}

/**
 * DocumentExplorer — the "documents as alive entities" view.
 *
 * Renders the doc preview + a chat surface bound to a single-document
 * intelligence session. The session is opened lazily on the first user
 * turn so navigating into the explorer is cheap.
 *
 * Pure React Native (no native PDF viewer dep) — the preview is a
 * filename + metadata card. The owner-web equivalent renders a full PDF
 * via react-pdf; mobile users tap-through to the platform viewer if the
 * URL is reachable.
 */
export function DocumentExplorer({ document, initialPrompt }: DocumentExplorerProps): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turns, setTurns] = useState<ReadonlyArray<ChatTurn>>([])
  const [draft, setDraft] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    // On mount, request a deterministic preview-summary if the doc is ready.
    // English default per CLAUDE.md (flipped 2026-05).
    if (document.ingestionStatus === 'ready') {
      summariseDocument({ documentId: document.id, language: 'en' })
        .then((res) => setSummary(res.summary))
        .catch(() => undefined)
    }
  }, [document.id, document.ingestionStatus])

  async function ensureSession(): Promise<string> {
    if (sessionId) {
      return sessionId
    }
    const { sessionId: newId } = await createSession({
      documentIds: [document.id],
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      title: `Soma: ${document.fileName}`,
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
      // English default per CLAUDE.md (flipped 2026-05).
      const res = await askSession({ sessionId: id, question, language: 'en' })
      const assistantText =
        res.answer ??
        `Question received. This document has ${res.evidenceIds.length} chunks. The brain will respond once processing finishes.`
      const assistantTurn: ChatTurn = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: assistantText,
      }
      setTurns((prev) => [...prev, assistantTurn])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Imeshindikana kuuliza.'
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
            <Text style={styles.chipText}>{kindLabel(document.kind)}</Text>
          </View>
          <View
            style={[
              styles.chip,
              document.ingestionStatus === 'ready' ? styles.chipReady : null,
              document.ingestionStatus === 'failed' ? styles.chipFailed : null,
            ]}
          >
            <Text style={styles.chipText}>{ingestionStatusLabel(document.ingestionStatus)}</Text>
          </View>
        </View>
      </View>

      {summary ? (
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Muhtasari</Text>
          <Text style={styles.summaryBody} numberOfLines={6}>
            {summary}
          </Text>
        </View>
      ) : null}

      <ScrollView style={styles.chatList} contentContainerStyle={styles.chatContent}>
        {turns.length === 0 ? (
          <Text style={styles.empty}>Anza mazungumzo na hati hii. Niulize lolote.</Text>
        ) : (
          turns.map((turn) => (
            <View
              key={turn.id}
              style={[
                styles.bubble,
                turn.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
            >
              <Text style={styles.bubbleText}>{turn.text}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Andika swali kuhusu hati"
          value={draft}
          onChangeText={setDraft}
          placeholder="Andika swali..."
          placeholderTextColor={colors.textMuted}
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
              accessibilityLabel="Tuma swali"
              onPress={handleSend}
              style={styles.sendLabel}
            >
              Tuma
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
    backgroundColor: colors.surface,
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fileName: {
    fontSize: fontSize.h3,
    fontWeight: '700',
    color: colors.text,
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
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipReady: {
    backgroundColor: '#DCEEDC',
    borderColor: colors.success,
  },
  chipFailed: {
    backgroundColor: '#F4D7D7',
    borderColor: colors.danger,
  },
  chipText: {
    fontSize: fontSize.caption,
    color: colors.text,
    fontWeight: '600',
  },
  summary: {
    padding: spacing.md,
    margin: spacing.lg,
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
  },
  summaryTitle: {
    fontWeight: '700',
    fontSize: fontSize.body,
    color: colors.text,
  },
  summaryBody: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: fontSize.body,
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
    color: colors.textMuted,
    marginTop: spacing.xl,
  },
  bubble: {
    padding: spacing.md,
    borderRadius: radius.md,
    maxWidth: '85%',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.earth700,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
  },
  bubbleText: {
    color: colors.textInverse,
    fontSize: fontSize.body,
  },
  errorBanner: {
    backgroundColor: '#F4D7D7',
    color: colors.danger,
    padding: spacing.sm,
    margin: spacing.md,
    borderRadius: radius.sm,
    fontSize: fontSize.caption,
  },
  composer: {
    flexDirection: 'row',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: fontSize.body,
    color: colors.text,
    maxHeight: 120,
  },
  sendButton: {
    padding: spacing.sm,
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    minWidth: 64,
    alignItems: 'center',
  },
  sendLabel: {
    color: colors.gold,
    fontWeight: '700',
    fontSize: fontSize.body,
  },
})
