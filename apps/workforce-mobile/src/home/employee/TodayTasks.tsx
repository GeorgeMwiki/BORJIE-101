import { useCallback, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { PreviewBanner } from '../../components/PreviewBanner'
import { enqueueWrite } from '../../sync/queue'
import { pickStrings } from '../../i18n'
import { pickByLocale } from '../../i18n/pickByLocale'
import { MIN_TAP_DP, type WorkerTask } from './types'

export interface TodayTasksProps {
  readonly tasks: ReadonlyArray<WorkerTask> | undefined
  readonly loading: boolean
  readonly error: Error | null
  readonly userId: string | null
  readonly lang: 'sw' | 'en'
}

/**
 * Priority → chip colour + the dictionary key for its single-locale label.
 * The label text itself flows through `t.todayTasks` so the chip is never a
 * hardcoded inline `isSw ? 'Haraka' : 'Urgent'` ternary (the mixing trap).
 */
function priorityChip(
  p: WorkerTask['priority'],
  t: ReturnType<typeof pickStrings>['todayTasks']
): { readonly bg: string; readonly fg: string; readonly label: string } {
  if (p === 'urgent') {
    return { bg: colors.danger, fg: colors.textInverse, label: t.priorityUrgent }
  }
  if (p === 'due') {
    return { bg: colors.warn, fg: colors.textInverse, label: t.priorityDue }
  }
  return { bg: colors.earth500, fg: colors.textInverse, label: t.priorityFlex }
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

  // Single active-locale dictionary — every label below resolves through
  // `t.todayTasks`, never an inline `isSw ? '…' : '…'` ternary.
  const t = pickStrings(lang).todayTasks

  if (loading) {
    return <Text style={styles.lead}>{t.loading}</Text>
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
        const chip = priorityChip(task.priority, t)
        // Active-locale title; a null active-locale value renders the localized
        // placeholder (`t.missingTitle`) — NEVER the other language's string.
        const title = pickByLocale(
          { en: task.titleEn ?? '', sw: task.titleSw ?? '' },
          lang
        )
        const titleLabel = title === '—' ? t.missingTitle : title
        const location =
          pickByLocale(
            { en: task.locationLabelEn ?? '', sw: task.locationLabelSw ?? '' },
            lang
          )
        const hasLocation = location !== '—'
        const parallelTag = task.parallelGroupId ? ` · ${t.parallelTag}` : ''
        const doneLabel = t.done
        const blockedLabel = t.blocked
        return (
          <View key={task.id} style={styles.card} testID={`employee-home-task-${task.id}`}>
            <View style={styles.cardHeader}>
              <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                <Text style={[styles.chipText, { color: chip.fg }]}>
                  {chip.label}
                </Text>
              </View>
              <Text style={styles.sequence}>#{task.sequence}</Text>
            </View>
            <Text style={styles.title}>{titleLabel}</Text>
            {hasLocation ? (
              <Text style={styles.meta}>
                {location}
                {parallelTag}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                onPress={() => onDone(task.id)}
                accessibilityRole="button"
                accessibilityLabel={doneLabel}
                style={({ pressed }) => [
                  styles.action,
                  styles.actionDone,
                  pressed ? styles.actionPressed : null
                ]}
                testID={`employee-home-task-done-${task.id}`}
              >
                <Text style={styles.actionDoneText}>{doneLabel}</Text>
              </Pressable>
              <Pressable
                onPress={() => onBlocked(task.id)}
                accessibilityRole="button"
                accessibilityLabel={blockedLabel}
                style={({ pressed }) => [
                  styles.action,
                  styles.actionBlock,
                  pressed ? styles.actionPressed : null
                ]}
                testID={`employee-home-task-block-${task.id}`}
              >
                <Text style={styles.actionBlockText}>{blockedLabel}</Text>
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
