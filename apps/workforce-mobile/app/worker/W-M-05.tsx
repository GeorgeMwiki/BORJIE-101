import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-05'

type Severity = 'low' | 'medium' | 'high'

interface PingRequest {
  readonly id: string
  readonly title: string
  readonly origin: string
  readonly receivedAtISO: string
  readonly severity: Severity
}

interface PingReply {
  readonly loads: string
  readonly blockers: string
  readonly sentAtISO: string
}

const REQUESTS: ReadonlyArray<PingRequest> = [
  {
    id: 'p1',
    title: 'Ping ya bench D — mizigo ngapi?',
    origin: 'SIC Geita · meneja',
    receivedAtISO: '2026-05-27T08:45:00+03:00',
    severity: 'high'
  },
  {
    id: 'p2',
    title: 'Ping ya excavator EX-02 — vizuizi?',
    origin: 'SIC Geita · auto',
    receivedAtISO: '2026-05-27T09:10:00+03:00',
    severity: 'medium'
  },
  {
    id: 'p3',
    title: 'Ping ya sampuli — zipo tayari?',
    origin: 'Lab Mwanza',
    receivedAtISO: '2026-05-27T09:35:00+03:00',
    severity: 'low'
  }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PingsView />
      </ScreenShell>
    </RoleGuard>
  )
}

function PingsView(): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loads, setLoads] = useState<string>('')
  const [blockers, setBlockers] = useState<string>('')
  const [sent, setSent] = useState<ReadonlyArray<readonly [string, PingReply]>>([])

  const onOpen = useCallback((id: string): void => {
    setActiveId((prev) => (prev === id ? null : id))
    setLoads('')
    setBlockers('')
  }, [])

  const onSend = useCallback((): void => {
    if (!activeId) return
    const reply: PingReply = {
      loads: loads.trim() || '0',
      blockers: blockers.trim() || 'hakuna',
      sentAtISO: new Date().toISOString()
    }
    setSent((prev) => [[activeId, reply], ...prev])
    setActiveId(null)
    setLoads('')
    setBlockers('')
  }, [activeId, loads, blockers])

  const pending = REQUESTS.filter((r) => !sent.some(([id]) => id === r.id))

  return (
    <View>
      <Section title={`Pings zinazosubiri (${pending.length})`} hint="Gusa ping ili kujibu">
        {pending.length === 0 ? (
          <Text style={styles.muted}>Hakuna ping mpya. Endelea na kazi.</Text>
        ) : (
          pending.map((req) => {
            const isActive = activeId === req.id
            return (
              <View key={req.id} style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={req.title}
                  onPress={() => onOpen(req.id)}
                  style={({ pressed }) => [styles.cardHeader, pressed && styles.cardPressed]}
                >
                  <View style={[styles.sev, sevStyles[req.severity]]}>
                    <Text style={styles.sevText}>{sevLabel(req.severity)}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.title}>{req.title}</Text>
                    <Text style={styles.meta}>{req.origin} · {formatHM(req.receivedAtISO)}</Text>
                  </View>
                </Pressable>
                {isActive ? (
                  <View style={styles.replyBox}>
                    <Text style={styles.fieldLabel}>Mizigo iliyofanyika</Text>
                    <TextInput
                      value={loads}
                      onChangeText={setLoads}
                      keyboardType="number-pad"
                      placeholder="mfano: 8"
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                      accessibilityLabel="Mizigo"
                    />
                    <Text style={styles.fieldLabel}>Vizuizi (kama vipo)</Text>
                    <TextInput
                      value={blockers}
                      onChangeText={setBlockers}
                      placeholder="mfano: tairi limepasuka"
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, styles.inputMulti]}
                      multiline
                      accessibilityLabel="Vizuizi"
                    />
                    <Button label="Tuma Jibu" onPress={onSend} />
                  </View>
                ) : null}
              </View>
            )
          })
        )}
      </Section>
      <Section title={`Majibu yaliyotumwa (${sent.length})`}>
        {sent.length === 0 ? (
          <Text style={styles.muted}>Bado hujajibu ping yoyote.</Text>
        ) : (
          sent.map(([id, reply]) => {
            const req = REQUESTS.find((r) => r.id === id)
            if (!req) return null
            return (
              <View key={id} style={styles.sentRow}>
                <Text style={styles.sentTitle}>{req.title}</Text>
                <Text style={styles.sentLine}>Mizigo: {reply.loads}</Text>
                <Text style={styles.sentLine}>Vizuizi: {reply.blockers}</Text>
              </View>
            )
          })
        )}
      </Section>
    </View>
  )
}

function sevLabel(s: Severity): string {
  if (s === 'high') return 'HARAKA'
  if (s === 'medium') return 'WASTANI'
  return 'POLE'
}

function formatHM(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const sevStyles = StyleSheet.create({
  low: { backgroundColor: colors.earth500 },
  medium: { backgroundColor: colors.warn },
  high: { backgroundColor: colors.danger }
})

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden'
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md
  },
  cardPressed: {
    backgroundColor: colors.earth100
  },
  cardBody: {
    flex: 1
  },
  sev: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    minWidth: 72,
    alignItems: 'center'
  },
  sevText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 1
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  replyBox: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm
  },
  fieldLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: fontSize.body
  },
  inputMulti: {
    minHeight: 64
  },
  sentRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  sentTitle: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  sentLine: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
