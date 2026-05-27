import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-02'

interface ShiftTask {
  readonly id: string
  readonly title: string
  readonly location: string
}

interface ShiftPlan {
  readonly startISO: string
  readonly endISO: string
  readonly nextBreakISO: string
  readonly siteName: string
  readonly tasks: ReadonlyArray<ShiftTask>
}

const SHIFT: ShiftPlan = {
  startISO: '2026-05-27T06:00:00+03:00',
  endISO: '2026-05-27T18:00:00+03:00',
  nextBreakISO: '2026-05-27T10:00:00+03:00',
  siteName: 'Geita · Pit 2',
  tasks: [
    { id: 't1', title: 'Drill mashimo 4', location: 'Block B' },
    { id: 't2', title: 'Funga sampuli za udongo', location: 'Bench top' },
    { id: 't3', title: 'Kagua njia ya excavator', location: 'Ramp 3' },
    { id: 't4', title: 'Andika ripoti ya zamu', location: 'Workshop' }
  ]
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <TodayView />
      </ScreenShell>
    </RoleGuard>
  )
}

function TodayView(): JSX.Element {
  const [started, setStarted] = useState<boolean>(false)
  const [doneIds, setDoneIds] = useState<ReadonlyArray<string>>([])

  const onStart = useCallback((): void => {
    setStarted(true)
  }, [])

  const toggleTask = useCallback((id: string): void => {
    setDoneIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const startLabel = useMemo(() => formatHM(SHIFT.startISO), [])
  const endLabel = useMemo(() => formatHM(SHIFT.endISO), [])
  const breakLabel = useMemo(() => relativeFromNow(SHIFT.nextBreakISO), [])
  const doneCount = doneIds.length

  return (
    <View>
      <Section title="Shifti ya leo" hint={SHIFT.siteName}>
        <View style={styles.timeCard}>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Anza</Text>
            <Text style={styles.timeValue}>{startLabel}</Text>
          </View>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Maliza</Text>
            <Text style={styles.timeValue}>{endLabel}</Text>
          </View>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Pumziko</Text>
            <Text style={styles.timeValueAccent}>{breakLabel}</Text>
          </View>
        </View>
        <Button
          label={started ? 'Shifti imeanza' : 'Anza Shifti'}
          onPress={onStart}
          disabled={started}
        />
      </Section>
      <Section title={`Kazi za leo (${doneCount}/${SHIFT.tasks.length})`}>
        {SHIFT.tasks.map((task) => {
          const done = doneIds.includes(task.id)
          return (
            <Pressable
              key={task.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={task.title}
              onPress={() => toggleTask(task.id)}
              style={({ pressed }) => [
                styles.task,
                done && styles.taskDone,
                pressed && styles.taskPressed
              ]}
            >
              <View style={[styles.checkbox, done && styles.checkboxDone]}>
                {done ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <View style={styles.taskBody}>
                <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{task.title}</Text>
                <Text style={styles.taskMeta}>{task.location}</Text>
              </View>
            </Pressable>
          )
        })}
      </Section>
    </View>
  )
}

function formatHM(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  return `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
}

function relativeFromNow(iso: string): string {
  const target = new Date(iso).getTime()
  if (!Number.isFinite(target)) return iso
  const diff = Math.max(0, Math.round((target - Date.now()) / 60000))
  if (diff <= 0) return 'sasa hivi'
  if (diff < 60) return `dakika ${diff}`
  const hours = Math.floor(diff / 60)
  const mins = diff % 60
  return `saa ${hours} dak ${mins}`
}

const styles = StyleSheet.create({
  timeCard: {
    flexDirection: 'row',
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.md
  },
  timeBlock: {
    flex: 1
  },
  timeLabel: {
    color: colors.earth100,
    fontSize: fontSize.caption,
    letterSpacing: 1
  },
  timeValue: {
    color: colors.textInverse,
    fontSize: fontSize.h2,
    fontWeight: '800',
    marginTop: spacing.xs
  },
  timeValueAccent: {
    color: colors.gold,
    fontSize: fontSize.h3,
    fontWeight: '800',
    marginTop: spacing.xs
  },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  taskPressed: {
    backgroundColor: colors.earth100
  },
  taskDone: {
    backgroundColor: colors.earth100
  },
  taskBody: {
    flex: 1
  },
  taskTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  taskTitleDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through'
  },
  taskMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.earth700,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxDone: {
    backgroundColor: colors.success,
    borderColor: colors.success
  },
  checkmark: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: fontSize.lead
  }
})
