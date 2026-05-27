import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { request } from '../../src/api/client'
import { API_BASE_URL } from '../../src/api/config'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-08'

const COPY = Object.freeze({
  loading: 'Inapakia hati zako…',
  asking: 'Inajibu swali…',
  errorInline: 'Imeshindwa kuwasiliana na huduma ya doc-chat.',
  validationEmpty: 'Tafadhali andika swali.',
  emptyDocs: 'Hakuna hati zilizoidhinishwa kwenye akaunti yako.',
  emptyTurns: 'Andika swali la kwanza ili kuanza mazungumzo.',
  sectionAsk: 'Uliza hati zako',
  sectionAskHint: 'Jibu lenye chanzo · evidence_id imethibitishwa',
  sectionCompose: 'Andika swali',
  sectionTurns: 'Maswali ya hivi karibuni',
  sectionDocs: 'Hati zilizopatikana',
  sourcesLabel: 'Chanzo:',
  pageLabel: 'ukurasa'
})

const DOC_CHAT_BASE = `${API_BASE_URL}/api/v1/doc-chat`
const DOCUMENTS_BASE = `${API_BASE_URL}/api/v1/documents`

interface DocRow {
  readonly id: string
  readonly name?: string | null
  readonly mimeType?: string | null
  readonly size?: number | null
  readonly verificationStatus?: string | null
  readonly createdAt?: string | null
}

interface DocumentsListResponse {
  readonly success: boolean
  readonly data?: ReadonlyArray<DocRow>
  readonly error?: { code?: string; message?: string }
}

interface ChatSession {
  readonly id: string
  readonly scope: string
  readonly documentIds: ReadonlyArray<string>
}

interface SessionEnvelope {
  readonly success: boolean
  readonly data?: ChatSession
  readonly error?: { code?: string; message?: string }
}

interface Citation {
  readonly documentId: string
  readonly chunkIndex: number
  readonly quote: string
  readonly score: number
  readonly page?: number
}

interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly citations?: ReadonlyArray<Citation>
  readonly createdAt?: string | null
}

interface AskEnvelope {
  readonly success: boolean
  readonly data?: {
    readonly userMessage: ChatMessage
    readonly assistantMessage: ChatMessage
    readonly fallback: boolean
  }
  readonly error?: { code?: string; message?: string }
}

interface QaTurn {
  readonly id: string
  readonly question: string
  readonly reply: string
  readonly citations: ReadonlyArray<Citation>
  readonly askedAtISO: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <DocumentChatView />
      </ScreenShell>
    </RoleGuard>
  )
}

function DocumentChatView(): JSX.Element {
  const queryClient = useQueryClient()
  const [turns, setTurns] = useState<ReadonlyArray<QaTurn>>([])
  const [draft, setDraft] = useState<string>('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const docsQuery = useQuery<ReadonlyArray<DocRow>, Error>({
    queryKey: ['doc-chat', 'documents'],
    queryFn: async ({ signal }) => {
      const envelope = await request<DocumentsListResponse>(DOCUMENTS_BASE, { signal })
      if (!envelope.success) {
        throw new Error(envelope.error?.message ?? COPY.errorInline)
      }
      return envelope.data ?? []
    }
  })

  const startSession = useMutation<ChatSession, Error, ReadonlyArray<string>>({
    mutationFn: async (documentIds) => {
      const envelope = await request<SessionEnvelope>(`${DOC_CHAT_BASE}/sessions`, {
        method: 'POST',
        body: { scope: 'multi_document', documentIds: [...documentIds] }
      })
      if (!envelope.success || !envelope.data) {
        throw new Error(envelope.error?.message ?? COPY.errorInline)
      }
      return envelope.data
    }
  })

  const askMutation = useMutation<
    { question: string; reply: string; citations: ReadonlyArray<Citation> },
    Error,
    { sessionId: string; question: string }
  >({
    mutationFn: async (input) => {
      const envelope = await request<AskEnvelope>(
        `${DOC_CHAT_BASE}/sessions/${encodeURIComponent(input.sessionId)}/ask`,
        {
          method: 'POST',
          body: { question: input.question }
        }
      )
      if (!envelope.success || !envelope.data) {
        throw new Error(envelope.error?.message ?? COPY.errorInline)
      }
      return {
        question: envelope.data.userMessage.content,
        reply: envelope.data.assistantMessage.content,
        citations: envelope.data.assistantMessage.citations ?? []
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['doc-chat'] })
    }
  })

  const docs = docsQuery.data ?? []
  const docLookup = useMemo<Record<string, DocRow>>(() => {
    const acc: Record<string, DocRow> = {}
    for (const doc of docs) {
      acc[doc.id] = doc
    }
    return Object.freeze(acc)
  }, [docs])

  const submit = useCallback(async (): Promise<void> => {
    const trimmed = draft.trim()
    if (trimmed.length === 0) {
      setValidationError(COPY.validationEmpty)
      return
    }
    setValidationError(null)
    try {
      let currentSessionId = sessionId
      if (!currentSessionId) {
        if (docs.length === 0) {
          setValidationError(COPY.emptyDocs)
          return
        }
        const session = await startSession.mutateAsync(docs.map((d) => d.id))
        currentSessionId = session.id
        setSessionId(currentSessionId)
      }
      const result = await askMutation.mutateAsync({
        sessionId: currentSessionId,
        question: trimmed
      })
      const turn: QaTurn = {
        id: `turn-${Date.now()}`,
        question: result.question,
        reply: result.reply,
        citations: result.citations,
        askedAtISO: new Date().toISOString()
      }
      setTurns((prev) => [turn, ...prev])
      setDraft('')
    } catch {
      // Surfacing via askMutation.isError below — keep handler quiet.
    }
  }, [askMutation, docs, draft, sessionId, startSession])

  if (docsQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (docsQuery.isError) {
    return (
      <View>
        {isBackendUnavailable(docsQuery.error) ? (
          <PreviewBanner kind="env-missing" />
        ) : (
          <Text style={styles.errorInline}>{COPY.errorInline}</Text>
        )}
      </View>
    )
  }

  if (docs.length === 0) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
        <Text style={styles.emptyHint}>{COPY.emptyDocs}</Text>
      </View>
    )
  }

  const askError = askMutation.error ?? startSession.error
  const askingNow = startSession.isPending || askMutation.isPending

  return (
    <View>
      <Section title={COPY.sectionAsk} hint={COPY.sectionAskHint}>
        <AskBorjie label="Uliza Hati" />
      </Section>
      <Section title={COPY.sectionCompose}>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={(value) => {
              setDraft(value)
              if (validationError && value.trim().length > 0) {
                setValidationError(null)
              }
            }}
            placeholder="Mfano: Lini PML 67890 itapata jibu?"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            editable={!askingNow}
          />
          {validationError ? (
            <Text style={styles.validationError}>{validationError}</Text>
          ) : null}
          {askError ? (
            isBackendUnavailable(askError) ? (
              <PreviewBanner kind="env-missing" />
            ) : (
              <Text style={styles.errorInline}>{COPY.errorInline}</Text>
            )
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tuma swali"
            onPress={() => void submit()}
            disabled={askingNow}
            style={({ pressed }) => [
              styles.send,
              askingNow && styles.sendDisabled,
              pressed && !askingNow && styles.sendPressed
            ]}
          >
            {askingNow ? (
              <ActivityIndicator color={colors.earth900} />
            ) : (
              <Text style={styles.sendLabel}>Tuma</Text>
            )}
          </Pressable>
        </View>
      </Section>
      <Section title={COPY.sectionTurns}>
        {turns.length === 0 ? (
          <Text style={styles.emptyHint}>{COPY.emptyTurns}</Text>
        ) : (
          turns.map((turn) => (
            <View key={turn.id} style={styles.turn}>
              <Text style={styles.question}>{turn.question}</Text>
              <Text style={styles.reply}>{turn.reply}</Text>
              {turn.citations.length > 0 ? (
                <View style={styles.sources}>
                  <Text style={styles.sourcesLabel}>{COPY.sourcesLabel}</Text>
                  {turn.citations.map((citation, index) => {
                    const doc = docLookup[citation.documentId]
                    const filename = doc?.name && doc.name.length > 0
                      ? doc.name
                      : citation.documentId
                    const page = citation.page
                      ? ` · ${COPY.pageLabel} ${citation.page}`
                      : ''
                    return (
                      <Text
                        key={`${turn.id}-cite-${index}`}
                        style={styles.sourceChip}
                      >
                        {filename}
                        {page}
                      </Text>
                    )
                  })}
                </View>
              ) : null}
            </View>
          ))
        )}
      </Section>
      <Section title={`${COPY.sectionDocs} (${docs.length})`}>
        {docs.map((doc) => (
          <View key={doc.id} style={styles.docRow}>
            <Text style={styles.docTitle}>{doc.name ?? doc.id}</Text>
            <Text style={styles.docMeta}>{describeDoc(doc)}</Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

function describeDoc(doc: DocRow): string {
  const parts: string[] = []
  if (typeof doc.size === 'number' && doc.size > 0) {
    parts.push(`${Math.round(doc.size / 1024)} KB`)
  }
  if (doc.mimeType) parts.push(doc.mimeType)
  if (doc.verificationStatus) parts.push(doc.verificationStatus)
  if (doc.createdAt) {
    const parsed = Date.parse(doc.createdAt)
    if (Number.isFinite(parsed)) {
      parts.push(new Date(parsed).toISOString().slice(0, 10))
    }
  }
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function isBackendUnavailable(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (error instanceof ApiError) return error.status >= 500 || error.status === 503
  return false
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    paddingVertical: spacing.xl
  },
  loadingLabel: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  errorInline: {
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginVertical: spacing.sm
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  validationError: {
    color: colors.warn,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  composer: {
    gap: spacing.sm
  },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    minHeight: 80,
    fontSize: fontSize.body
  },
  send: {
    alignSelf: 'flex-end',
    backgroundColor: colors.gold,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    minWidth: 100,
    alignItems: 'center'
  },
  sendPressed: {
    backgroundColor: colors.goldDark
  },
  sendDisabled: {
    opacity: 0.6
  },
  sendLabel: {
    color: colors.earth900,
    fontWeight: '700',
    fontSize: fontSize.body
  },
  turn: {
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1
  },
  question: {
    color: colors.text,
    fontWeight: '700',
    fontSize: fontSize.lead
  },
  reply: {
    color: colors.textMuted,
    marginTop: spacing.xs,
    fontSize: fontSize.body
  },
  sources: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs
  },
  sourcesLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  sourceChip: {
    backgroundColor: colors.earth100,
    color: colors.earth900,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    fontSize: fontSize.caption,
    fontWeight: '600',
    overflow: 'hidden'
  },
  docRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  docTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  docMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
