import { StyleSheet, Text, View } from 'react-native'
import { Section } from '../components/Section'
import { useI18n } from '../i18n/useI18n'
import { CrewRoster } from '../home/manager/CrewRoster'
import { ExceptionStack } from '../home/manager/ExceptionStack'
import { SitePulse } from '../home/manager/SitePulse'
import { pickCopy } from '../home/manager/copy'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

/**
 * ManagerDashboard — 4-band layout per Docs/research R3.
 *
 * Bands:
 *  1. SitePulse — 5 KPI tiles (existing component)
 *  2. ExceptionStack — live incidents + maintenance (existing component)
 *  3. CrewRoster — vertical list of crew on shift (existing component)
 *  4. TaskQueue — inline placeholder until B-Manager ships /tasks/unassigned
 *
 * `siteId` is null so the api-gateway resolves the actor's bound site from
 * the JWT — the per-band hooks already handle that contract.
 */
export function ManagerDashboard(): JSX.Element {
  return (
    <View testID="manager-dashboard">
      <SitePulse siteId={null} />
      <ExceptionStack siteId={null} />
      <CrewRoster siteId={null} />
      <TaskQueueSlot />
    </View>
  )
}

function TaskQueueSlot(): JSX.Element {
  const { lang } = useI18n()
  const title = pickCopy(lang, 'bandTasks')
  const empty = pickCopy(lang, 'emptyTasks')
  const lineUp = pickCopy(lang, 'lineUpHint')
  return (
    <Section title={title} hint={lineUp}>
      <View style={styles.taskRow} accessibilityRole="summary" accessibilityLabel={empty}>
        <Text style={styles.taskLabel}>{empty}</Text>
        <Text style={styles.taskHint}>
          {lang === 'sw'
            ? 'Foleni itajaa pale B-Manager atakapowezesha /tasks/unassigned.'
            : 'Queue will populate once /tasks/unassigned is wired.'}
        </Text>
      </View>
    </Section>
  )
}

const styles = StyleSheet.create({
  taskRow: {
    backgroundColor: colors.earth700,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    minHeight: 64
  },
  taskLabel: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  taskHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
