import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useI18n } from '../../src/i18n/useI18n'
import { workforcePersonaSpec } from '../../src/roles/persona'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-16'

interface AskTurn {
  id: string
  question: string
  reply: string
  askedAtISO: string
}

const SEED_TURNS: ReadonlyArray<AskTurn> = [
  {
    id: 'q1',
    question: 'Nifanye nini ikiwa fuel imekwisha?',
    reply:
      'Wasiliana na meneja wa zamu mara moja, andika namba ya jenereta, na simamisha shughuli za kuvunja mwamba mpaka kuhakikishwa salama.',
    askedAtISO: '2026-05-26T07:14:00Z'
  },
  {
    id: 'q2',
    question: 'Nina kuumia kidogo, je nirudi nyumbani?',
    reply:
      'Ripoti jeraha kwa kiongozi wa zamu kwa fomu W-M-12. Borjie itatuma daktari wa karibu na kushikilia malipo ya siku.',
    askedAtISO: '2026-05-26T11:02:00Z'
  }
]

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
  const [turns, setTurns] = useState<ReadonlyArray<AskTurn>>(SEED_TURNS)
  const [draft, setDraft] = useState<string>('')
  const personaSlug = workforcePersonaSpec('employee').slug

  const submit = useCallback((): void => {
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    const turn: AskTurn = {
      id: `q-${turns.length + 1}`,
      question: trimmed,
      reply: t.app.borjieReply,
      askedAtISO: new Date().toISOString()
    }
    setTurns([turn, ...turns])
    setDraft('')
  }, [draft, turns, t.app.borjieReply])

  return (
    <View>
      <Section title="Uliza kwa Kiswahili">
        <AskBorjie />
      </Section>
      <Section title="Andika swali">
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Andika swali lako hapa…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tuma swali"
            onPress={submit}
            style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
          >
            <Text style={styles.sendLabel}>Tuma</Text>
          </Pressable>
        </View>
      </Section>
      <Section title={`Maswali ya hivi karibuni (persona: ${personaSlug})`}>
        {turns.map((turn) => (
          <View key={turn.id} style={styles.turn}>
            <Text style={styles.question}>{turn.question}</Text>
            <Text style={styles.reply}>{turn.reply}</Text>
            <Text style={styles.timestamp}>{formatRelative(turn.askedAtISO)}</Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return iso
  const minutesAgo = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutesAgo < 1) return 'sasa hivi'
  if (minutesAgo < 60) return `dakika ${minutesAgo} zilizopita`
  const hoursAgo = Math.round(minutesAgo / 60)
  return `saa ${hoursAgo} zilizopita`
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
