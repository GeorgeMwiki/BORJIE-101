import { StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n/useI18n'
import { useOnlineStatus } from '../offline/useOnlineStatus'
import { useQueueSize } from '../sync/useQueueSize'
import { PerformanceSnapshot } from '../home/employee/PerformanceSnapshot'
import { ShiftStatusHero } from '../home/employee/ShiftStatusHero'
import { TodayTasks } from '../home/employee/TodayTasks'
import {
  useActiveAlerts,
  useNextStepCoach,
  usePerformanceSnapshot,
  useTodayShift,
  useTodayTasks,
  useToolboxTalk
} from '../home/employee/queries'
import { MAX_ALERTS, type CoachSuggestion, type IncidentAlert, type ToolboxTalk } from '../home/employee/types'
import { PreviewBanner } from '../components/PreviewBanner'
import { Section } from '../components/Section'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

/**
 * EmployeeDashboard — 8 worker-guidance sections per Docs/research R2.
 *
 * Sections (in render order):
 *  1. ShiftStatusHero (existing component) — clock in/out + elapsed time
 *  2. SafetyBriefing — inline, today's toolbox talk acknowledgement
 *  3. TodayTasks (existing component) — sequenced task cards
 *  4. ActiveAlerts — inline, ≤3 incidents assigned to me
 *  5. PerformanceSnapshot (existing component) — single number + delta
 *  6. NextStepCoach — inline, Borjie's next-best-action suggestion
 *  7. QuickActions — inline, the four most-tapped worker verbs
 *  8. SyncStatus — inline, offline queue size + connectivity
 *
 * Each section fetches independently so one env-missing endpoint doesn't
 * blank the dashboard — worker-guidance §9 behavioural rule.
 */
export function EmployeeDashboard(): JSX.Element {
  const { user } = useAuth()
  const { lang } = useI18n()
  const { online } = useOnlineStatus()
  const userId = user?.id ?? null

  const shiftQuery = useTodayShift(userId)
  const tasksQuery = useTodayTasks(userId)
  const perfQuery = usePerformanceSnapshot(userId)
  const toolboxQuery = useToolboxTalk()
  const alertsQuery = useActiveAlerts()
  const coachQuery = useNextStepCoach(userId)

  return (
    <View testID="employee-dashboard">
      <ShiftStatusHero
        shift={shiftQuery.data}
        loading={shiftQuery.isLoading}
        error={shiftQuery.error ?? null}
        online={online}
        userId={userId}
      />
      <SafetyBriefingSlot
        talk={toolboxQuery.data ?? null}
        loading={toolboxQuery.isLoading}
        error={toolboxQuery.error ?? null}
        lang={lang}
      />
      <Section title={lang === 'sw' ? 'Kazi za leo' : "Today's tasks"}>
        <TodayTasks
          tasks={tasksQuery.data}
          loading={tasksQuery.isLoading}
          error={tasksQuery.error ?? null}
          userId={userId}
          lang={lang}
        />
      </Section>
      <ActiveAlertsSlot
        alerts={alertsQuery.data ?? []}
        loading={alertsQuery.isLoading}
        error={alertsQuery.error ?? null}
        lang={lang}
      />
      <Section title={lang === 'sw' ? 'Takwimu zako' : 'Your performance'}>
        <PerformanceSnapshot
          data={perfQuery.data}
          loading={perfQuery.isLoading}
          error={perfQuery.error ?? null}
          lang={lang}
        />
      </Section>
      <NextStepCoachSlot
        coach={coachQuery.data ?? null}
        loading={coachQuery.isLoading}
        error={coachQuery.error ?? null}
        lang={lang}
      />
      <QuickActionsSlot lang={lang} />
      <SyncStatusSlot online={online} lang={lang} />
    </View>
  )
}

interface SafetyBriefingProps {
  readonly talk: ToolboxTalk | null
  readonly loading: boolean
  readonly error: Error | null
  readonly lang: 'sw' | 'en'
}

function SafetyBriefingSlot({ talk, loading, error, lang }: SafetyBriefingProps): JSX.Element {
  const title = lang === 'sw' ? 'Mada ya usalama (Toolbox)' : 'Safety briefing (Toolbox)'
  if (loading) {
    return (
      <Section title={title}>
        <Text style={styles.muted}>{lang === 'sw' ? 'Inapakia…' : 'Loading…'}</Text>
      </Section>
    )
  }
  if (error) {
    return (
      <Section title={title}>
        <PreviewBanner kind="env-missing" />
      </Section>
    )
  }
  if (!talk) {
    return (
      <Section title={title}>
        <PreviewBanner kind="no-data" />
      </Section>
    )
  }
  const acknowledged = talk.acknowledgedAtIso !== null
  const tone = acknowledged ? colors.success : colors.warn
  const statusLabel = acknowledged
    ? lang === 'sw' ? 'Imesainiwa' : 'Acknowledged'
    : lang === 'sw' ? 'Inahitaji saini' : 'Awaiting acknowledgement'
  return (
    <Section title={title}>
      <View style={[styles.toolbox, { borderLeftColor: tone }]}>
        <Text style={styles.toolboxTitle}>
          {lang === 'sw' ? talk.titleSw : talk.titleEn}
        </Text>
        <Text style={[styles.toolboxStatus, { color: tone }]}>{statusLabel}</Text>
      </View>
    </Section>
  )
}

interface ActiveAlertsProps {
  readonly alerts: ReadonlyArray<IncidentAlert>
  readonly loading: boolean
  readonly error: Error | null
  readonly lang: 'sw' | 'en'
}

function ActiveAlertsSlot({ alerts, loading, error, lang }: ActiveAlertsProps): JSX.Element {
  const title = lang === 'sw' ? 'Arifa za sasa' : 'Active alerts'
  if (loading) {
    return (
      <Section title={title}>
        <Text style={styles.muted}>{lang === 'sw' ? 'Inapakia…' : 'Loading…'}</Text>
      </Section>
    )
  }
  if (error) {
    return (
      <Section title={title}>
        <PreviewBanner kind="env-missing" />
      </Section>
    )
  }
  if (alerts.length === 0) {
    return (
      <Section title={title}>
        <Text style={styles.muted}>
          {lang === 'sw' ? 'Hakuna arifa. Endelea kazi salama.' : 'No alerts. Stay safe out there.'}
        </Text>
      </Section>
    )
  }
  const capped = alerts.slice(0, MAX_ALERTS)
  return (
    <Section title={title}>
      {capped.map((alert) => {
        const tone = alert.severity === 'high'
          ? colors.danger
          : alert.severity === 'medium'
            ? colors.warn
            : colors.earth500
        return (
          <View
            key={alert.id}
            testID={`employee-dashboard-alert-${alert.id}`}
            style={[styles.alertRow, { borderLeftColor: tone }]}
          >
            <Text style={styles.alertTitle}>
              {lang === 'sw' ? alert.titleSw : alert.titleEn}
            </Text>
          </View>
        )
      })}
    </Section>
  )
}

interface NextStepCoachProps {
  readonly coach: CoachSuggestion | null
  readonly loading: boolean
  readonly error: Error | null
  readonly lang: 'sw' | 'en'
}

function NextStepCoachSlot({ coach, loading, error, lang }: NextStepCoachProps): JSX.Element {
  const title = lang === 'sw' ? 'Hatua inayofuata · Borjie' : 'Next-step coach · Borjie'
  if (loading) {
    return (
      <Section title={title}>
        <Text style={styles.muted}>{lang === 'sw' ? 'Borjie inafikiri…' : 'Borjie is thinking…'}</Text>
      </Section>
    )
  }
  if (error) {
    return (
      <Section title={title}>
        <PreviewBanner kind="env-missing" />
      </Section>
    )
  }
  if (!coach) {
    return (
      <Section title={title}>
        <PreviewBanner kind="no-data" />
      </Section>
    )
  }
  const text = lang === 'sw' ? coach.suggestionSw : coach.suggestionEn
  const evidence = lang === 'sw'
    ? `Ushahidi ${coach.evidenceIds.length}`
    : `Evidence ${coach.evidenceIds.length}`
  return (
    <Section title={title}>
      <View style={styles.coach}>
        <Text style={styles.coachBody}>{text}</Text>
        <Text style={styles.coachMeta}>{evidence}</Text>
      </View>
    </Section>
  )
}

function QuickActionsSlot({ lang }: { readonly lang: 'sw' | 'en' }): JSX.Element {
  const title = lang === 'sw' ? 'Vitendo vya haraka' : 'Quick actions'
  const labels = lang === 'sw'
    ? ['Ripoti tukio', 'Kumbukumbu ya mafuta', 'Uliza msimamizi', 'Toa risiti ya PPE']
    : ['Log incident', 'Log fuel', 'Ask supervisor', 'PPE receipt']
  return (
    <Section title={title}>
      <View style={styles.actionsRow}>
        {labels.map((label) => (
          <View key={label} style={styles.actionChip}>
            <Text style={styles.actionChipText}>{label}</Text>
          </View>
        ))}
      </View>
    </Section>
  )
}

function SyncStatusSlot({
  online,
  lang
}: {
  readonly online: boolean
  readonly lang: 'sw' | 'en'
}): JSX.Element {
  const queueSize = useQueueSize()
  const title = lang === 'sw' ? 'Hali ya sync' : 'Sync status'
  const connectivityLabel = online
    ? lang === 'sw' ? 'Mtandaoni' : 'Online'
    : lang === 'sw' ? 'Nje ya mtandao' : 'Offline'
  const queueLabel = lang === 'sw'
    ? `Foleni: ${queueSize}`
    : `Queue: ${queueSize}`
  const tone = online ? colors.success : colors.warn
  return (
    <Section title={title}>
      <View style={[styles.sync, { borderLeftColor: tone }]}>
        <Text style={[styles.syncStatus, { color: tone }]}>{connectivityLabel}</Text>
        <Text style={styles.syncQueue}>{queueLabel}</Text>
      </View>
    </Section>
  )
}

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  toolbox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    minHeight: 56
  },
  toolboxTitle: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  toolboxStatus: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  alertRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    minHeight: 48
  },
  alertTitle: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  coach: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold
  },
  coachBody: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  coachMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: spacing.xs
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  actionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    minHeight: 44,
    justifyContent: 'center'
  },
  actionChipText: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  sync: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    minHeight: 56
  },
  syncStatus: {
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  syncQueue: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
