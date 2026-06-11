/**
 * Marketplace projection screen — the workforce side of the
 * owner-spawn → workforce tab-projection bridge.
 *
 * This tab only appears when the owner has spawned a marketplace-kind
 * tab in the owner cockpit (see app/(tabs)/_layout.tsx +
 * src/lib/workforce-tab-projection.ts). It renders a KNOWN kind
 * parameterized by the projection (owner label + origin line) and a
 * REAL task-scoped query: the worker's next open assigned task from
 * `/api/v1/field/workforce/tasks/next` (mining_tasks filtered to the
 * authenticated user — tenant + user scoped server-side).
 *
 * Honest states: loading spinner, empty ("no assigned task"), error with
 * retry. NO mock data. Locale-pure: every string is single-language via
 * the active i18n bundle; the task title uses titleEn/titleSw per lang.
 */
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { useI18n } from '../../src/i18n/useI18n'
import { useWorkforceTabConfig } from '../../src/lib/hooks/useWorkforceTabConfig'
import { fieldApi } from '../../src/api/client'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

interface NextTaskResponse {
  readonly id: string
  readonly titleEn: string
  readonly titleSw: string
  readonly location?: string
  readonly startedAt?: string
  readonly dueAt?: string
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly task: NextTaskResponse | null }
  | { readonly kind: 'error' }

export default function MarketplaceProjectionTab(): JSX.Element {
  const { t, lang } = useI18n()
  const { projectedTabs } = useWorkforceTabConfig()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const projection = projectedTabs.find((p) => p.kind === 'marketplace') ?? null

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' })
    try {
      const task = await fieldApi.get<NextTaskResponse | null>(
        '/workforce/tasks/next'
      )
      setState({ kind: 'ready', task: task && task.id ? task : null })
    } catch {
      setState({ kind: 'error' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const taskTitle = (task: NextTaskResponse): string =>
    lang === 'sw' ? task.titleSw : task.titleEn

  return (
    <ScreenShell screenId="W-M-MKT">
      {projection ? (
        <View style={styles.originCard}>
          <Text style={styles.originLabel}>{projection.label}</Text>
          <Text style={styles.originHint}>{t.projection.originOwner}</Text>
        </View>
      ) : null}
      <Section title={t.projection.assignedTasks}>
        {state.kind === 'loading' ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={colors.goldDark} />
            <Text style={styles.stateText}>{t.common.loading}</Text>
          </View>
        ) : null}
        {state.kind === 'error' ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>{t.common.errorGeneric}</Text>
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                pressed ? styles.retryButtonPressed : null
              ]}
              onPress={() => {
                void load()
              }}
            >
              <Text style={styles.retryLabel}>{t.common.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {state.kind === 'ready' && state.task === null ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>{t.projection.noTasks}</Text>
          </View>
        ) : null}
        {state.kind === 'ready' && state.task !== null ? (
          <View style={styles.taskCard}>
            <Text style={styles.taskTitle}>{taskTitle(state.task)}</Text>
            {state.task.location ? (
              <Text style={styles.taskMeta}>
                {t.projection.location}: {state.task.location}
              </Text>
            ) : null}
            {state.task.dueAt ? (
              <Text style={styles.taskMeta}>
                {t.projection.due}: {state.task.dueAt.slice(0, 10)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Section>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  originCard: {
    padding: spacing.md,
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg
  },
  originLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  originHint: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
    letterSpacing: 0.4
  },
  stateWrap: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm
  },
  stateText: {
    color: colors.text,
    fontSize: fontSize.body
  },
  retryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  retryButtonPressed: {
    backgroundColor: colors.earth300
  },
  retryLabel: {
    color: colors.goldDark,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  taskCard: {
    padding: spacing.md,
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  taskTitle: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  taskMeta: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
