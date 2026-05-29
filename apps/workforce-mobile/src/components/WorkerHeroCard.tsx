/**
 * WorkerHeroCard — next-task hero rendered above the worker home chat.
 *
 * Source: `Docs/RESEARCH/worker-guidance-sota.md` §1 — DoorDash /
 * CommCare / Apple-Fitness-rings hero pattern. Roadmap R5.
 *
 * The card shows the worker name + role, current shift status, the
 * single next assigned task (with timer when started), and two large
 * tap targets: "Imekamilika / Done" + "Need help".
 *
 * Bilingual labels live next to their EN counterpart. The shift status
 * pill is colour-tone-coded (active = success, on_break = warn,
 * off_shift = muted, no_shift = muted).
 *
 * The card is pure-presentation: it never mounts data. The parent passes
 * `WorkerHeroCardData` derived from `/v1/workforce/me` + `mining_tasks`
 * (or live SSE). Callbacks bubble user intents (`onMarkComplete`,
 * `onNeedHelp`) so the parent can route them to brain tools.
 */

import { useEffect, useState, type ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { tokens } from '../ui-litfin'
import {
  formatTimerHms,
  selectShiftVisual,
  type ShiftStatus,
  type ShiftStatusVisual,
  type WorkerHeroCardData,
  type WorkerHeroTask,
} from './worker-hero-card.helpers'

export {
  formatTimerHms,
  selectShiftVisual,
  type ShiftStatus,
  type ShiftStatusVisual,
  type WorkerHeroCardData,
  type WorkerHeroTask,
}

export interface WorkerHeroCardProps {
  readonly data: WorkerHeroCardData
  readonly locale: 'sw' | 'en'
  readonly onMarkComplete?: (taskId: string) => void
  readonly onNeedHelp?: (taskId: string | null) => void
  /**
   * Inject a clock for the running timer. Defaults to `Date.now`. Test
   * harnesses pass a deterministic function.
   */
  readonly now?: () => number
}

export function WorkerHeroCard({
  data,
  locale,
  onMarkComplete,
  onNeedHelp,
  now = Date.now,
}: WorkerHeroCardProps): ReactElement {
  const isSw = locale === 'sw'
  const shiftVisual = selectShiftVisual(data.shiftStatus)
  const shiftLabel = isSw ? shiftVisual.labelSw : shiftVisual.labelEn
  const noTaskLabel = isSw
    ? 'Hakuna kazi inayofuata'
    : 'No next task assigned'
  const noTaskHelp = isSw
    ? 'Pumzika, msimamizi atakupa kazi mpya hivi karibuni.'
    : 'Stand by. A supervisor will assign the next task shortly.'
  const startCtaLabel = isSw ? 'Imekamilika' : 'Mark done'
  const helpLabel = isSw ? 'Naomba msaada' : 'Need help'
  const inProgressLabel = isSw ? 'Inaendelea' : 'In progress'

  // Live timer — tick once a second while a task has a startedAt and we
  // are visibly active. Cleared on unmount and on task swap.
  const startedAtMs = data.nextTask?.startedAt
    ? new Date(data.nextTask.startedAt).getTime()
    : null
  const [, setTick] = useState<number>(0)
  useEffect(() => {
    if (startedAtMs === null) return
    const handle = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(handle)
  }, [startedAtMs])

  const elapsedMs =
    startedAtMs !== null ? Math.max(0, now() - startedAtMs) : null

  const taskTitle = data.nextTask
    ? isSw
      ? data.nextTask.titleSw
      : data.nextTask.titleEn
    : null
  const taskLocation = data.nextTask?.location ?? null

  return (
    <View
      testID="worker-hero-card"
      accessibilityRole="summary"
      style={styles.root}
    >
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text style={styles.eyebrow}>
            {isSw ? 'MFANYAKAZI' : 'WORKER'}
          </Text>
          <Text style={styles.name} numberOfLines={1}>
            {data.workerName}
          </Text>
          <Text style={styles.roleLabel} numberOfLines={1}>
            {data.roleLabel}
          </Text>
        </View>
        <View
          testID={`worker-hero-shift-pill-${data.shiftStatus}`}
          style={[styles.shiftPill, shiftPillToneStyle(shiftVisual.tone)]}
        >
          <Text
            style={[styles.shiftPillLabel, shiftPillToneText(shiftVisual.tone)]}
          >
            {shiftLabel}
          </Text>
        </View>
      </View>

      {data.shiftDetail ? (
        <Text style={styles.shiftDetail} numberOfLines={1}>
          {data.shiftDetail}
        </Text>
      ) : null}

      <View style={styles.taskBlock}>
        <Text style={styles.taskEyebrow}>
          {isSw ? 'KAZI INAYOFUATA' : 'NEXT TASK'}
        </Text>
        {data.nextTask !== null ? (
          <>
            <Text testID="worker-hero-task-title" style={styles.taskTitle}>
              {taskTitle}
            </Text>
            {taskLocation ? (
              <Text style={styles.taskLocation}>{taskLocation}</Text>
            ) : null}
            <View style={styles.taskFooter}>
              {elapsedMs !== null ? (
                <View
                  testID="worker-hero-timer"
                  style={[styles.timerPill, styles.timerPillActive]}
                >
                  <Text style={styles.timerLabel}>{inProgressLabel}</Text>
                  <Text style={styles.timerValue}>
                    {formatTimerHms(elapsedMs)}
                  </Text>
                </View>
              ) : (
                <View style={[styles.timerPill, styles.timerPillIdle]}>
                  <Text style={styles.timerLabelIdle}>
                    {isSw ? 'Bado haijaanza' : 'Not started'}
                  </Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            <Text testID="worker-hero-no-task" style={styles.taskTitle}>
              {noTaskLabel}
            </Text>
            <Text style={styles.taskLocation}>{noTaskHelp}</Text>
          </>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          testID="worker-hero-mark-complete"
          accessibilityRole="button"
          accessibilityLabel={startCtaLabel}
          disabled={data.nextTask === null}
          onPress={() => {
            if (data.nextTask !== null && onMarkComplete) {
              onMarkComplete(data.nextTask.id)
            }
          }}
          style={({ pressed }) => [
            styles.primaryAction,
            data.nextTask === null && styles.actionDisabled,
            pressed && styles.actionPressed,
          ]}
        >
          <Text style={styles.primaryActionLabel}>{startCtaLabel}</Text>
        </Pressable>
        <Pressable
          testID="worker-hero-need-help"
          accessibilityRole="button"
          accessibilityLabel={helpLabel}
          onPress={() => {
            if (onNeedHelp) {
              onNeedHelp(data.nextTask?.id ?? null)
            }
          }}
          style={({ pressed }) => [
            styles.secondaryAction,
            pressed && styles.actionPressed,
          ]}
        >
          <Text style={styles.secondaryActionLabel}>{helpLabel}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function shiftPillToneStyle(tone: ShiftStatusVisual['tone']): {
  backgroundColor: string
  borderColor: string
} {
  switch (tone) {
    case 'success':
      return {
        backgroundColor: 'rgba(67, 192, 113, 0.16)',
        borderColor: 'rgba(67, 192, 113, 0.46)',
      }
    case 'warn':
      return {
        backgroundColor: 'rgba(255, 200, 87, 0.18)',
        borderColor: tokens.color.borderGold,
      }
    case 'muted':
    default:
      return {
        backgroundColor: tokens.color.bgRaised,
        borderColor: tokens.color.border,
      }
  }
}

function shiftPillToneText(tone: ShiftStatusVisual['tone']): {
  color: string
} {
  switch (tone) {
    case 'success':
      return { color: '#84E5A1' }
    case 'warn':
      return { color: tokens.color.gold }
    case 'muted':
    default:
      return { color: tokens.color.textMuted }
  }
}

const styles = StyleSheet.create({
  root: {
    borderRadius: tokens.radius.xl,
    backgroundColor: tokens.color.aiBubbleBg,
    borderWidth: 1,
    borderColor: tokens.color.aiBubbleBorder,
    paddingVertical: tokens.space.lg,
    paddingHorizontal: tokens.space.lg,
    marginHorizontal: tokens.space.lg,
    marginTop: tokens.space.md,
    marginBottom: tokens.space.lg,
    ...tokens.shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.space.md,
  },
  identity: {
    flexShrink: 1,
  },
  eyebrow: {
    ...tokens.type.eyebrow,
    color: tokens.color.textMuted,
  },
  name: {
    ...tokens.type.h2,
    color: tokens.color.textPrimary,
    marginTop: tokens.space.xs,
  },
  roleLabel: {
    ...tokens.type.bodySm,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.xs,
  },
  shiftPill: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
  },
  shiftPillLabel: {
    ...tokens.type.micro,
  },
  shiftDetail: {
    ...tokens.type.bodySm,
    color: tokens.color.textMuted,
    marginTop: tokens.space.sm,
  },
  taskBlock: {
    marginTop: tokens.space.lg,
    paddingTop: tokens.space.md,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
  },
  taskEyebrow: {
    ...tokens.type.eyebrow,
    color: tokens.color.gold,
  },
  taskTitle: {
    ...tokens.type.h3,
    color: tokens.color.textPrimary,
    marginTop: tokens.space.sm,
  },
  taskLocation: {
    ...tokens.type.bodySm,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.xs,
  },
  taskFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: tokens.space.md,
    gap: tokens.space.sm,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
  },
  timerPillActive: {
    backgroundColor: 'rgba(255, 200, 87, 0.12)',
    borderColor: tokens.color.borderGold,
  },
  timerPillIdle: {
    backgroundColor: tokens.color.bgRaised,
    borderColor: tokens.color.border,
  },
  timerLabel: {
    ...tokens.type.micro,
    color: tokens.color.gold,
  },
  timerLabelIdle: {
    ...tokens.type.micro,
    color: tokens.color.textMuted,
  },
  timerValue: {
    ...tokens.type.bodySmStrong,
    color: tokens.color.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    gap: tokens.space.md,
    marginTop: tokens.space.lg,
  },
  primaryAction: {
    flex: 1,
    backgroundColor: tokens.color.gold,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionLabel: {
    ...tokens.type.bodyStrong,
    color: tokens.color.userBubbleText,
  },
  secondaryAction: {
    flex: 1,
    backgroundColor: tokens.color.bgRaised,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  secondaryActionLabel: {
    ...tokens.type.bodyStrong,
    color: tokens.color.textPrimary,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionDisabled: {
    opacity: 0.45,
  },
})
