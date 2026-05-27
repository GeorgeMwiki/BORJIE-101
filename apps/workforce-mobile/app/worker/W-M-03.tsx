import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-03'

type Severity = 'info' | 'warn' | 'danger'

interface BriefingItem {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly severity: Severity
}

const ITEMS: ReadonlyArray<BriefingItem> = [
  {
    id: 'b1',
    title: 'Hatari ya leo: mteremko wa kusini',
    detail: 'Mvua imelainisha bench. Kaa angalau mita 3 mbali na ukingo.',
    severity: 'danger'
  },
  {
    id: 'b2',
    title: 'PPE muhimu',
    detail: 'Kofia, viatu vya chuma, jaketi, miwani, glavu.',
    severity: 'warn'
  },
  {
    id: 'b3',
    title: 'Excavator EX-04 ina huduma',
    detail: 'Tumia EX-02 mpaka saa 14:00.',
    severity: 'info'
  },
  {
    id: 'b4',
    title: 'Maji safi ya kunywa',
    detail: 'Pata kontena karibu na kambi ya kaskazini.',
    severity: 'info'
  },
  {
    id: 'b5',
    title: 'Nambari ya dharura',
    detail: 'Foreman: +255 754 000 000 · Lab: +255 754 111 222',
    severity: 'warn'
  }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <BriefingView />
      </ScreenShell>
    </RoleGuard>
  )
}

function BriefingView(): JSX.Element {
  const [acked, setAcked] = useState<ReadonlyArray<string>>([])
  const [signed, setSigned] = useState<boolean>(false)

  const toggle = useCallback((id: string): void => {
    setAcked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const onSign = useCallback((): void => {
    setSigned(true)
  }, [])

  const allAcked = useMemo(() => acked.length === ITEMS.length, [acked])
  const progress = `${acked.length}/${ITEMS.length}`

  return (
    <View>
      <Section title={`Mada za toolbox (${progress})`} hint="Gusa kila mada baada ya kusoma">
        {ITEMS.map((item) => {
          const isAcked = acked.includes(item.id)
          return (
            <Pressable
              key={item.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isAcked }}
              accessibilityLabel={item.title}
              onPress={() => toggle(item.id)}
              style={({ pressed }) => [
                styles.row,
                isAcked && styles.rowAcked,
                pressed && styles.rowPressed
              ]}
            >
              <View style={[styles.tag, severityStyles[item.severity]]}>
                <Text style={styles.tagText}>{severityLabel(item.severity)}</Text>
              </View>
              <View style={styles.body}>
                <Text style={[styles.title, isAcked && styles.titleAcked]}>{item.title}</Text>
                <Text style={styles.detail}>{item.detail}</Text>
              </View>
              <View style={[styles.checkbox, isAcked && styles.checkboxAcked]}>
                {isAcked ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
            </Pressable>
          )
        })}
      </Section>
      <Section title="Thibitisha kwa kidole">
        {allAcked ? (
          <FingerprintPlaceholder
            label={signed ? 'Imethibitishwa' : 'Saini kuthibitisha'}
            onSign={onSign}
          />
        ) : (
          <View style={styles.lock}>
            <Text style={styles.lockText}>Soma na gusa mada zote kabla ya kusaini.</Text>
          </View>
        )}
      </Section>
    </View>
  )
}

function severityLabel(s: Severity): string {
  if (s === 'danger') return 'HATARI'
  if (s === 'warn') return 'ONYO'
  return 'TAARIFA'
}

const severityStyles = StyleSheet.create({
  info: { backgroundColor: colors.earth500 },
  warn: { backgroundColor: colors.warn },
  danger: { backgroundColor: colors.danger }
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  rowPressed: {
    backgroundColor: colors.earth100
  },
  rowAcked: {
    opacity: 0.7
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    minWidth: 64,
    alignItems: 'center'
  },
  tagText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 1
  },
  body: {
    flex: 1
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  titleAcked: {
    color: colors.textMuted,
    textDecorationLine: 'line-through'
  },
  detail: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  checkbox: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.earth700,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxAcked: {
    backgroundColor: colors.success,
    borderColor: colors.success
  },
  checkmark: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: fontSize.lead
  },
  lock: {
    padding: spacing.lg,
    backgroundColor: colors.earth100,
    borderRadius: radius.md
  },
  lockText: {
    color: colors.earth700,
    fontSize: fontSize.body
  }
})
