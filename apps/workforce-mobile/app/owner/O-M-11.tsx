import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-11'

type Decision = 'pending' | 'approved' | 'rejected'

interface ApprovalTask {
  id: string
  title: string
  requester: string
  amountTzs: number
  site: string
  priority: 'high' | 'medium' | 'low'
}

const SEED: ReadonlyArray<ApprovalTask> = [
  { id: 'PO-482', title: 'Manunuzi ya dieseli (PO #482)', requester: 'Meneja Geita', amountTzs: 4_200_000, site: 'Geita Pit-A', priority: 'high' },
  { id: 'HR-118', title: 'Ajira mpya: Surveyor', requester: 'HR Office', amountTzs: 1_800_000, site: 'Chunya', priority: 'medium' },
  { id: 'OT-902', title: 'Saa za ziada Excav-2', requester: 'Shift Lead Mwanza', amountTzs: 320_000, site: 'Mwanza', priority: 'low' },
  { id: 'PO-487', title: 'Kuzima jenereta na huduma', requester: 'Foreman Geita', amountTzs: 950_000, site: 'Geita Pit-B', priority: 'medium' }
]

const PRIORITY_LABEL: Readonly<Record<ApprovalTask['priority'], string>> = {
  high: 'Kipaumbele cha juu',
  medium: 'Kati',
  low: 'Chini'
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ScheduledApprovals />
      </ScreenShell>
    </RoleGuard>
  )
}

function ScheduledApprovals(): JSX.Element {
  const [decisions, setDecisions] = useState<Readonly<Record<string, Decision>>>({})

  const decide = useCallback((id: string, value: Decision): void => {
    setDecisions((current) => ({ ...current, [id]: value }))
  }, [])

  const summary = useMemo(() => {
    const approved = Object.values(decisions).filter((d) => d === 'approved').length
    const rejected = Object.values(decisions).filter((d) => d === 'rejected').length
    return { approved, rejected, pending: SEED.length - approved - rejected }
  }, [decisions])

  return (
    <View>
      <Section title={`Muhtasari: ${summary.pending} zinasubiri - ${summary.approved} zilizoidhinishwa - ${summary.rejected} zilizokataliwa`}>
        <View style={styles.metricRow}>
          <MetricChip label="Subiri" value={summary.pending} tone="warn" />
          <MetricChip label="Idhinisha" value={summary.approved} tone="success" />
          <MetricChip label="Kataa" value={summary.rejected} tone="danger" />
        </View>
      </Section>
      <Section title="Maombi yanayosubiri">
        {SEED.map((task) => {
          const state: Decision = decisions[task.id] ?? 'pending'
          return (
            <View key={task.id} style={[styles.card, state === 'approved' && styles.cardApproved, state === 'rejected' && styles.cardRejected]}>
              <Text style={styles.cardTitle}>{task.title}</Text>
              <Text style={styles.cardMeta}>
                {task.requester} - {task.site} - TZS {task.amountTzs.toLocaleString()}
              </Text>
              <Text style={styles.cardPriority}>{PRIORITY_LABEL[task.priority]}</Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Idhinisha ${task.id}`}
                  onPress={() => decide(task.id, 'approved')}
                  style={[styles.btn, state === 'approved' && styles.btnApprovedActive]}
                >
                  <Text style={[styles.btnLabel, state === 'approved' && styles.btnLabelActive]}>Idhinisha</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Kataa ${task.id}`}
                  onPress={() => decide(task.id, 'rejected')}
                  style={[styles.btn, styles.btnReject, state === 'rejected' && styles.btnRejectedActive]}
                >
                  <Text style={[styles.btnLabel, state === 'rejected' && styles.btnLabelActive]}>Kataa</Text>
                </Pressable>
              </View>
            </View>
          )
        })}
      </Section>
    </View>
  )
}

interface MetricChipProps {
  label: string
  value: number
  tone: 'success' | 'warn' | 'danger'
}

function MetricChip({ label, value, tone }: MetricChipProps): JSX.Element {
  const toneColor = tone === 'success' ? colors.success : tone === 'warn' ? colors.warn : colors.danger
  return (
    <View style={[styles.metric, { borderColor: toneColor }]}>
      <Text style={[styles.metricValue, { color: toneColor }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center'
  },
  metricValue: { fontSize: fontSize.h2, fontWeight: '800' },
  metricLabel: { color: colors.textMuted, fontSize: fontSize.caption, marginTop: spacing.xs },
  card: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1
  },
  cardApproved: { borderColor: colors.success, backgroundColor: '#EAF4EA' },
  cardRejected: { borderColor: colors.danger, backgroundColor: '#F4E5E6' },
  cardTitle: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  cardMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  cardPriority: { color: colors.goldDark, fontSize: fontSize.caption, fontWeight: '600', marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center'
  },
  btnReject: {},
  btnApprovedActive: { backgroundColor: colors.success, borderColor: colors.success },
  btnRejectedActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnLabel: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  btnLabelActive: { color: colors.textInverse }
})
