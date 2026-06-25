/**
 * Commercial chain L4 — manager task-queue.
 *
 * Lists the tenant's open mining_tasks rows. Each row is tappable and
 * deep-links to `/(manager)/tasks/[id]/assign` for the assign-worker
 * flow. RFB-fulfilment rows are highlighted (`kind === 'rfb_fulfill'`)
 * so the manager can see the buyer pipeline at a glance.
 *
 * Bilingual sw/en throughout.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { ScreenShell } from '../../../src/components/ScreenShell'
import { Section } from '../../../src/components/Section'
import { RoleGuard } from '../../../src/components/RoleGuard'
import { useManagerOpenTasks } from '../../../src/manager/useManagerTasks'
import { useI18n } from '../../../src/i18n/useI18n'
import type { StringDict } from '../../../src/i18n'
import type { Lang } from '../../../src/auth/types'
import { taskStatusLabel } from '../../../src/i18n/enumLabels'
import { pickByLocale } from '../../../src/i18n/pickByLocale'
import { colors } from '../../../src/theme/colors'
import { fontSize, radius, spacing } from '../../../src/theme/spacing'

const SCREEN_ID = 'M-M-01'

export default function ManagerTasksScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ManagerTasksView />
    </RoleGuard>
  )
}

function ManagerTasksView(): JSX.Element {
  const tasksQuery = useManagerOpenTasks()
  const { lang, t } = useI18n()
  const copy = t.managerTasks

  const tasks = tasksQuery.data ?? []
  const rfbTasks = tasks.filter((task) => task.kind === 'rfb_fulfill')
  const standardTasks = tasks.filter((task) => task.kind !== 'rfb_fulfill')

  return (
    <ScreenShell screenId={SCREEN_ID}>
      <Section title={copy.rfbTitle} hint={copy.rfbHint}>
        {tasksQuery.isPending ? (
          <Text style={styles.empty}>{copy.loading}</Text>
        ) : tasksQuery.isError ? (
          <Text style={styles.error}>{copy.loadFailed}</Text>
        ) : rfbTasks.length === 0 ? (
          <Text style={styles.empty}>{copy.rfbEmpty}</Text>
        ) : (
          <View style={styles.list}>
            {rfbTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                lang={lang}
                t={t}
                accent={colors.gold}
              />
            ))}
          </View>
        )}
      </Section>

      <Section title={copy.standardTitle} hint={copy.standardHint}>
        {standardTasks.length === 0 ? (
          <Text style={styles.empty}>{copy.standardEmpty}</Text>
        ) : (
          <View style={styles.list}>
            {standardTasks.map((task) => (
              <TaskCard key={task.id} task={task} lang={lang} t={t} />
            ))}
          </View>
        )}
      </Section>
    </ScreenShell>
  )
}

interface TaskCardProps {
  readonly task: ReturnType<typeof useManagerOpenTasks>['data'] extends
    | ReadonlyArray<infer T>
    | undefined
    ? T
    : never
  readonly lang: Lang
  readonly t: StringDict
  readonly accent?: string
}

function TaskCard({ task, lang, t, accent }: TaskCardProps): JSX.Element {
  const copy = t.managerTasks
  // Active-locale title; null active-locale value renders the placeholder,
  // NEVER the other language (no `titleEn ?? titleSw` cross-fallback).
  const title = pickByLocale(
    { en: task.titleEn ?? '', sw: task.titleSw ?? '' },
    lang
  )
  return (
    <Link href={`/(manager)/tasks/${task.id}/assign`} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.card,
          accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null,
          pressed ? styles.cardPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel={copy.assignA11y.replace('{{title}}', title)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.priorityChip}>
            <Text style={styles.priorityChipText}>
              {task.priority.toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>
            {copy.statusLabel} {taskStatusLabel(task.status, t)}
          </Text>
          {task.assignedToUserId ? (
            <Text style={styles.cardMetaText}>
              {copy.workerLabel}{' '}
              {task.assignedToUserId.slice(0, 8)}…
            </Text>
          ) : (
            <Text style={styles.cardMetaText}>{copy.unassigned}</Text>
          )}
        </View>
      </Pressable>
    </Link>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardPressed: {
    backgroundColor: colors.earth300,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  cardMeta: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cardMetaText: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  priorityChip: {
    backgroundColor: colors.earth700,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityChipText: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontStyle: 'italic',
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.body,
  },
})
