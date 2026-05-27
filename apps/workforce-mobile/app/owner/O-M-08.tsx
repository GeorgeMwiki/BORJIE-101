import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-08'

interface SourceDoc {
  readonly id: string
  readonly title: string
  readonly category: 'leseni' | 'assay' | 'mkataba' | 'usalama'
  readonly dateLabel: string
  readonly pages: number
}

interface QaTurn {
  readonly id: string
  readonly question: string
  readonly reply: string
  readonly sources: ReadonlyArray<string>
  readonly askedAtISO: string
}

const DOCS: ReadonlyArray<SourceDoc> = [
  { id: 'doc1', title: 'PML 12345 renewal letter', category: 'leseni', dateLabel: '2026-05-12', pages: 8 },
  { id: 'doc2', title: 'Geita assay 2026-05', category: 'assay', dateLabel: '2026-05-22', pages: 14 },
  { id: 'doc3', title: 'Mkataba wa mnunuzi Dar', category: 'mkataba', dateLabel: '2026-05-18', pages: 22 },
  { id: 'doc4', title: 'Ripoti ya usalama Mwanza', category: 'usalama', dateLabel: '2026-05-25', pages: 6 },
  { id: 'doc5', title: 'PML 67890 application', category: 'leseni', dateLabel: '2026-04-30', pages: 11 }
]

const SEED_TURNS: ReadonlyArray<QaTurn> = [
  {
    id: 'q1',
    question: 'Lini PML 12345 inakwisha?',
    reply: 'PML 12345 inakwisha tarehe 2026-06-10. Hati ya kuomba upya inahitajika ndani ya siku 30.',
    sources: ['doc1'],
    askedAtISO: '2026-05-26T09:20:00Z'
  },
  {
    id: 'q2',
    question: 'Ni daraja gani la dhahabu kutoka Geita mwezi huu?',
    reply: 'Wastani wa daraja ni 4.2 g/t kutoka sampuli 36. Hii ni ongezeko la 0.3 g/t ikilinganishwa na mwezi uliopita.',
    sources: ['doc2'],
    askedAtISO: '2026-05-26T11:45:00Z'
  }
]

type CategoryFilter = 'all' | SourceDoc['category']

const FILTERS: ReadonlyArray<{ key: CategoryFilter; label: string }> = [
  { key: 'all', label: 'Zote' },
  { key: 'leseni', label: 'Leseni' },
  { key: 'assay', label: 'Assay' },
  { key: 'mkataba', label: 'Mikataba' },
  { key: 'usalama', label: 'Usalama' }
]

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
  const { t } = useI18n()
  const [turns, setTurns] = useState<ReadonlyArray<QaTurn>>(SEED_TURNS)
  const [draft, setDraft] = useState<string>('')
  const [filter, setFilter] = useState<CategoryFilter>('all')

  const docsByCategory = useMemo<ReadonlyArray<SourceDoc>>(
    () => (filter === 'all' ? DOCS : DOCS.filter((d) => d.category === filter)),
    [filter]
  )

  const submit = useCallback((): void => {
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    const firstDoc = docsByCategory[0]
    const turn: QaTurn = {
      id: `q-${turns.length + 1}`,
      question: trimmed,
      reply: t.app.borjieReply,
      sources: firstDoc ? [firstDoc.id] : [],
      askedAtISO: new Date().toISOString()
    }
    setTurns([turn, ...turns])
    setDraft('')
  }, [draft, turns, t.app.borjieReply, docsByCategory])

  const docLookup = useMemo<Record<string, SourceDoc>>(
    () => DOCS.reduce<Record<string, SourceDoc>>((acc, doc) => ({ ...acc, [doc.id]: doc }), {}),
    []
  )

  return (
    <View>
      <Section title="Uliza hati zako" hint="Jibu lenye chanzo · evidence_id imethibitishwa">
        <AskBorjie label="Uliza Hati" />
      </Section>
      <Section title="Andika swali">
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Mfano: Lini PML 67890 itapata jibu?"
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
      <Section title="Maswali ya hivi karibuni">
        {turns.map((turn) => (
          <View key={turn.id} style={styles.turn}>
            <Text style={styles.question}>{turn.question}</Text>
            <Text style={styles.reply}>{turn.reply}</Text>
            {turn.sources.length > 0 ? (
              <View style={styles.sources}>
                <Text style={styles.sourcesLabel}>Chanzo:</Text>
                {turn.sources.map((sid) => {
                  const doc = docLookup[sid]
                  if (!doc) {
                    return null
                  }
                  return (
                    <Text key={sid} style={styles.sourceChip}>
                      {doc.title}
                    </Text>
                  )
                })}
              </View>
            ) : null}
          </View>
        ))}
      </Section>
      <Section title="Chuja hati">
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              accessibilityRole="button"
              accessibilityLabel={f.label}
              onPress={() => setFilter(f.key)}
              style={({ pressed }) => [
                styles.chip,
                filter === f.key && styles.chipActive,
                pressed && styles.chipPressed
              ]}
            >
              <Text style={[styles.chipLabel, filter === f.key && styles.chipLabelActive]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {docsByCategory.map((doc) => (
          <View key={doc.id} style={styles.docRow}>
            <Text style={styles.docTitle}>{doc.title}</Text>
            <Text style={styles.docMeta}>
              {categoryLabel(doc.category)} · {doc.dateLabel} · kurasa {doc.pages}
            </Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

function categoryLabel(category: SourceDoc['category']): string {
  if (category === 'leseni') return 'Leseni'
  if (category === 'assay') return 'Assay'
  if (category === 'mkataba') return 'Mkataba'
  return 'Usalama'
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border
  },
  chipActive: {
    backgroundColor: colors.earth700,
    borderColor: colors.earth700
  },
  chipPressed: {
    opacity: 0.7
  },
  chipLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  chipLabelActive: {
    color: colors.textInverse
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
