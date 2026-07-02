import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { workforcePersonaSpec } from '../../src/roles/persona'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'
import { API_BASE_URL } from '../../src/api/config'
import { ApiError } from '../../src/api/errors'
import { getAuthToken } from '../../src/auth/session'

const SCREEN_ID = 'W-M-16'

interface AskTurn {
  readonly id: string
  readonly question: string
  readonly reply: string
  readonly askedAtISO: string
}

interface BrainTurnResponse {
  readonly threadId: string
  readonly responseText: string
  readonly finalPersonaId?: string
  readonly tokensUsed?: number
}

async function postBrainTurn(args: { userText: string; threadId: string | null }): Promise<BrainTurnResponse> {
  const url = `${API_BASE_URL}/api/v1/brain/turn`
  const token = await getAuthToken()
  if (!token) {
    throw new ApiError('not_authenticated', 401, url, null)
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      userText: args.userText,
      ...(args.threadId ? { threadId: args.threadId } : {})
    })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(`brain.turn ${res.status}`, res.status, url, text.slice(0, 200))
  }
  return (await res.json()) as BrainTurnResponse
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <AskBorjieChat />
      </ScreenShell>
    </RoleGuard>
  )
}

function AskBorjieChat(): JSX.Element {
  const { t } = useI18n()
  const COPY = t.workerScreens.statusCopy
  const personaSlug = workforcePersonaSpec('employee').slug
  const [turns, setTurns] = useState<ReadonlyArray<AskTurn>>([])
  const [draft, setDraft] = useState<string>('')
  const [threadId, setThreadId] = useState<string | null>(null)

  const mutation = useMutation<BrainTurnResponse, ApiError, string>({
    mutationFn: (userText) => postBrainTurn({ userText, threadId }),
    onSuccess: (data, userText) => {
      const turn: AskTurn = {
        id: data.threadId + ':' + Date.now().toString(36),
        question: userText,
        reply: data.responseText,
        askedAtISO: new Date().toISOString()
      }
      setTurns((prev) => [turn, ...prev])
      setThreadId(data.threadId)
      setDraft('')
    }
  })

  const submit = useCallback((): void => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || mutation.isPending) return
    mutation.mutate(trimmed)
  }, [draft, mutation])

  return (
    <View>
      <Section title={COPY.wm16VoiceTitle}>
        <AskBorjie />
      </Section>
      <Section title={COPY.wm16ComposerTitle}>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={COPY.wm16ComposerPlaceholder}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            editable={!mutation.isPending}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.wm16SendCta}
            onPress={submit}
            disabled={mutation.isPending || draft.trim().length === 0}
            style={({ pressed }) => [
              styles.send,
              pressed && styles.sendPressed,
              (mutation.isPending || draft.trim().length === 0) && styles.sendDisabled
            ]}
          >
            <Text style={styles.sendLabel}>{COPY.wm16SendCta}</Text>
          </Pressable>
        </View>
        {mutation.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.loadingText}>{COPY.wm16Loading}</Text>
          </View>
        ) : null}
        {mutation.isError ? (
          <PreviewBanner kind="env-missing" />
        ) : null}
      </Section>
      <Section title={`${COPY.wm16HistoryTitle} (persona: ${personaSlug})`}>
        {turns.length === 0 ? (
          <PreviewBanner kind="no-data" />
        ) : (
          turns.map((turn) => (
            <View key={turn.id} style={styles.turn}>
              <Text style={styles.question}>{turn.question}</Text>
              <Text style={styles.reply}>{turn.reply}</Text>
              <Text style={styles.timestamp}>{formatRelative(turn.askedAtISO, COPY)}</Text>
            </View>
          ))
        )}
      </Section>
    </View>
  )
}

function formatRelative(
  iso: string,
  copy: { wm16JustNow: string; wm16MinutesAgo: string; wm16HoursAgo: string }
): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return iso
  const minutesAgo = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutesAgo < 1) return copy.wm16JustNow
  if (minutesAgo < 60) return copy.wm16MinutesAgo.replace('{n}', String(minutesAgo))
  const hoursAgo = Math.round(minutesAgo / 60)
  return copy.wm16HoursAgo.replace('{n}', String(hoursAgo))
}

const styles = StyleSheet.create({
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
    borderRadius: radius.pill
  },
  sendPressed: {
    backgroundColor: colors.goldDark
  },
  sendDisabled: {
    opacity: 0.5
  },
  sendLabel: {
    color: colors.earth900,
    fontWeight: '700',
    fontSize: fontSize.body
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  turn: {
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1
  },
  question: {
    color: colors.text,
    fontWeight: '600',
    fontSize: fontSize.lead
  },
  reply: {
    color: colors.textMuted,
    marginTop: spacing.xs,
    fontSize: fontSize.body
  },
  timestamp: {
    color: colors.textMuted,
    marginTop: spacing.xs,
    fontSize: fontSize.caption
  }
})
