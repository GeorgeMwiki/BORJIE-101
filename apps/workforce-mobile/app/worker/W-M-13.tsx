import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-13'

interface ToolboxTopic {
  id: string
  title: string
  durationMin: number
  acknowledged: boolean
}

const SEED_TOPICS: ReadonlyArray<ToolboxTopic> = [
  { id: 'topic-1', title: 'Lockout / Tagout — mashine za nguvu', durationMin: 5, acknowledged: false },
  { id: 'topic-2', title: 'Mvua na pit slope — hatari ya kuanguka', durationMin: 4, acknowledged: false },
  { id: 'topic-3', title: 'Mafuta na moto — eneo la kuhifadhi', durationMin: 6, acknowledged: false },
  { id: 'topic-4', title: 'PPE — kofia, viatu, miwani', durationMin: 3, acknowledged: false },
  { id: 'topic-5', title: 'Ripoti ya tukio kwa fomu W-M-14', durationMin: 4, acknowledged: false }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ToolboxTalk />
      </ScreenShell>
    </RoleGuard>
  )
}

function ToolboxTalk(): JSX.Element {
  const [topics, setTopics] = useState<ReadonlyArray<ToolboxTopic>>(SEED_TOPICS)
  const [signed, setSigned] = useState<boolean>(false)

  const toggle = useCallback(
    (id: string): void => {
      setTopics(
        topics.map((topic) =>
          topic.id === id ? { ...topic, acknowledged: !topic.acknowledged } : topic
        )
      )
    },
    [topics]
  )

  const completedCount = useMemo<number>(
    () => topics.filter((topic) => topic.acknowledged).length,
    [topics]
  )

  const allDone = completedCount === topics.length

  const onSign = useCallback((): void => {
    if (!allDone) return
    setSigned(true)
  }, [allDone])

  return (
    <View>
      <Section title={`Mada ya leo (${completedCount} / ${topics.length})`}>
        {topics.map((topic) => (
          <Pressable
            key={topic.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: topic.acknowledged }}
            accessibilityLabel={topic.title}
            onPress={() => toggle(topic.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View
              style={[
                styles.checkbox,
                topic.acknowledged ? styles.checkboxChecked : null
              ]}
            >
              {topic.acknowledged ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowPrimary}>{topic.title}</Text>
              <Text style={styles.rowSecondary}>{topic.durationMin} dakika</Text>
            </View>
          </Pressable>
        ))}
      </Section>
      <Section title="Thibitisha kwa kidole">
        {signed ? (
          <View style={styles.signed}>
            <Text style={styles.signedTitle}>Asante — umesaini</Text>
            <Text style={styles.signedHint}>
              Toolbox-talk imethibitishwa. Inasubiri sync ya hali ya juu.
            </Text>
          </View>
        ) : (
          <View>
            {!allDone ? (
              <Text style={styles.note}>Bonyeza mada zote kabla ya kusaini</Text>
            ) : null}
            <FingerprintPlaceholder
              label={allDone ? 'Saini kwa kidole' : 'Inasubiri…'}
              onSign={onSign}
            />
          </View>
        )}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  pressed: {
    opacity: 0.85
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.earth700,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    backgroundColor: colors.surface
  },
  checkboxChecked: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  tick: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  rowBody: {
    flex: 1
  },
  rowPrimary: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  rowSecondary: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  note: {
    color: colors.warn,
    fontSize: fontSize.body,
    textAlign: 'center',
    marginBottom: spacing.sm
  },
  signed: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.success
  },
  signedTitle: {
    color: colors.success,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  signedHint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
