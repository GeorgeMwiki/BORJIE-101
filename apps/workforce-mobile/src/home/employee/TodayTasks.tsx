import { useCallback, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { PreviewBanner } from '../../components/PreviewBanner'
import { enqueueWrite } from '../../sync/queue'
import { MIN_TAP_DP, type WorkerTask } from './types'

export interface TodayTasksProps {
  readonly tasks: ReadonlyArray<WorkerTask> | undefined
  readonly loading: boolean
  readonly error: Error | null
  readonly userId: string | null
  readonly lang: 'sw' | 'en'
}

function priorityChip(p: WorkerTask['priority']): {
  readonly bg: string
  readonly fg: string
  readonly sw: string
  readonly en: string
} {
  if (p === 'urgent') {
    return { bg: colors.danger, fg: colors.textInverse, sw: 'Haraka', en: 'Urgent' }
  }
  if (p === 'due') {
    return { bg: colors.warn, fg: colors.textInverse, sw: 'Inakaribia', en: 'Due' }
  }
  return { bg: colors.earth500, fg: colors.textInverse, sw: 'Bila haraka', en: 'Flex' }
}

export function TodayTasks({
  tasks,
  loading,
  error,
  userId,
  lang
}: TodayTasksProps): JSX.Element {
  const onDone = useCallback(
    (taskId: string): void => {
      if (!userId) {
        return
      }
      void enqueueWrite('toolbox_ack', { kind: 'task_complete', taskId, userId, at: Date.now() })
    },
    [userId]
  )

  const onBlocked = useCallback(
    (taskId: string): void => {
      if (!userId) {
        return
      }
      void enqueueWrite('incident', {
        category: 'block',
        taskId,
        userId,
        raisedAtIso: new Date().toISOString()
      })
    },
    [userId]
  )

  const sorted = useMemo<ReadonlyArray<WorkerTask>>(() => {
    if (!tasks) {
      return []
    }
    return [...tasks].sort((a, b) => a.sequence - b.sequence)
  }, [tasks])

  if (loading) {
    return <Text style={styles.lead}>Inapakia kazi za leo… / Loading today's tasks…</Text>
  }
  if (error) {
    return <PreviewBanner kind="env-missing" />
  }
  if (sorted.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  return (
    <View>
      {sorted.map((task) => {
        const chip = priorityChip(task.priority)
        const title = lang === 'sw' ? task.titleSw : task.titleEn
        const location =
          (lang === 'sw' ? task.locationLabelSw : task.locationLabelEn) ?? ''
        const parallelTag = task.parallelGroupId ? ' · Sambamba / Parallel' : ''
        return (
          <View key={task.id} style={styles.card} testID={`employee-home-task-${task.id}`}>
            <View style={styles.cardHeader}>
              <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                <Text style={[styles.chipText, { color: chip.fg }]}>
                  {chip.sw} / {chip.en}
                </Text>
              </View>
              <Text style={styles.sequence}>#{task.sequence}</Text>
            </View>
            <Text style={styles.title}>{title}</Text>
            {location ? (
              <Text style={styles.meta}>
                {location}
                {parallelTag}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                onPress={() => onDone(task.id)}
                accessibilityRole="button"
                accessibilityLabel="Imekamilika / Done"
                style={({ pressed }) => [
                  styles.action,
                  styles.actionDone,
                  pressed ? styles.actionPressed : null
                ]}
                testID={`employee-home-task-done-${task.id}`}
              >
                <Text style={styles.actionDoneText}>Imekamilika / Done</Text>
              </Pressable>
              <Pressable
                onPress={() => onBlocked(task.id)}
                accessibilityRole="button"
                accessibilityLabel="Shida / Blocked"
                style={({ pressed }) => [
                  styles.action,
                  styles.actionBlock,
                  pressed ? styles.actionPressed : null
                ]}
                testID={`employee-home-task-block-${task.id}`}
              >
                <Text style={styles.actionBlockText}>Shida / Blocked</Text>
              </Pressable>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  lead: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    paddingVertical: spacing.md
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill
  },
  chipText: {
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  sequence: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  title: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginTop: spacing.sm
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm
  },
  action: {
    flex: 1,
    minHeight: MIN_TAP_DP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionDone: {
    backgroundColor: colors.gold
  },
  actionBlock: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.danger
  },
  actionPressed: {
    opacity: 0.85
  },
  actionDoneText: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  actionBlockText: {
    color: colors.danger,
    fontSize: fontSize.lead,
    fontWeight: '700'
  }
})
