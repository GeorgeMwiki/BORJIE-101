import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'
import { useTodayShift, type ShiftTaskLite } from '../../src/home/worker/useTodayShift'

const SCREEN_ID = 'W-M-02'

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
  // R39 — Replace the hardcoded SHIFT fixture with a live query against
  // /api/v1/field/workforce/shifts/today. The hook falls back to a
  // deterministic empty shift offline so the screen never collapses.
  const shiftQuery = useTodayShift()
  const shift = shiftQuery.data

  const onStart = useCallback((): void => {
    setStarted(true)
  }, [])

  const toggleTask = useCallback((id: string): void => {
    setDoneIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const startLabel = useMemo(
    () => (shift ? formatHM(shift.startISO) : '—'),
    [shift]
  )
  const endLabel = useMemo(
    () => (shift ? formatHM(shift.endISO) : '—'),
    [shift]
  )
  const breakLabel = useMemo(
    () =>
      shift?.nextBreakISO != null
        ? relativeFromNow(shift.nextBreakISO)
        : 'Hapana',
    [shift]
  )
  const doneCount = doneIds.length
  const taskCount = shift?.tasks.length ?? 0
  const siteName = shift?.siteName ?? '—'

  if (shiftQuery.isPending) {
    return (
      <View style={styles.loadingWrap} accessibilityRole="progressbar">
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingText}>Inapakia shifti…</Text>
      </View>
    )
  }

  if (shiftQuery.isError) {
    return (
      <Section title="Shifti ya leo">
        <Text style={styles.errorText}>
          Imeshindwa kupakia shifti. Jaribu tena.
        </Text>
        <Button
          label="Jaribu Tena"
          onPress={() => {
            void shiftQuery.refetch()
          }}
        />
      </Section>
    )
  }

  return (
    <View>
      <Section title="Shifti ya leo" hint={siteName}>
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
      <Section title={`Kazi za leo (${doneCount}/${taskCount})`}>
        {taskCount === 0 ? (
          <Text style={styles.emptyText}>
            Hakuna kazi iliyokupewa leo.
          </Text>
        ) : (
          (shift?.tasks ?? []).map((task: ShiftTaskLite) => {
            const done = doneIds.includes(task.id)
            const title = task.titleSw.length > 0 ? task.titleSw : task.titleEn
            const where = task.location ?? '—'
            return (
              <Pressable
                key={task.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={title}
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
                  <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{title}</Text>
                  <Text style={styles.taskMeta}>{where}</Text>
                </View>
              </Pressable>
            )
          })
        )}
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
  loadingWrap: {
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  errorText: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginBottom: spacing.md
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    padding: spacing.md
  },
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
