import { StyleSheet, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { PreviewBanner } from '../components/PreviewBanner'
import { AiDailyBrief } from '../home/owner/AiDailyBrief'
import { AlertQueue } from '../home/owner/AlertQueue'
import { KpiStrip } from '../home/owner/KpiStrip'
import { ProductionVsTarget } from '../home/owner/ProductionVsTarget'
import { useOwnerBrief } from '../home/owner/useOwnerBrief'
import { formatCurrency } from '../home/owner/format'
import type { OwnerBrief } from '../home/owner/types'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

/**
 * OwnerDashboard — 7-slot owner status surface per Docs/research R1.
 *
 * Slots:
 *  1. AiDailyBrief (existing component)
 *  2. AlertQueue (existing component)
 *  3. KpiStrip (existing component)
 *  4. ProductionVsTarget (existing component)
 *  5. CashRunway — inline, runway days + USD-cliff exposure
 *  6. ComplianceSafety — inline, licence + incident pillar status
 *  7. QuickActions — inline, the four most-tapped owner verbs
 *
 * Loading/error/empty render via PreviewBanner (no fake data, no spinners
 * that block other cards). Single useOwnerBrief() round-trip feeds every
 * data-driven slot — the inline cards just pluck from the same brief.
 */
export function OwnerDashboard(): JSX.Element {
  const { lang } = useI18n()
  const query = useOwnerBrief()

  if (query.isLoading) {
    return <PreviewBanner kind="no-data" />
  }
  if (query.isError || !query.data) {
    return <PreviewBanner kind="env-missing" />
  }
  const brief = query.data

  return (
    <View testID="owner-dashboard">
      <AiDailyBrief brief={brief} lang={lang} />
      <AlertQueue items={brief.needsReview} lang={lang} />
      <KpiStrip brief={brief} lang={lang} />
      <ProductionVsTarget production={brief.production} lang={lang} />
      <CashRunwaySlot brief={brief} lang={lang} />
      <ComplianceSafetySlot brief={brief} lang={lang} />
      <QuickActionsSlot lang={lang} />
    </View>
  )
}

interface SlotProps {
  readonly brief: OwnerBrief
  readonly lang: 'sw' | 'en'
}

function CashRunwaySlot({ brief, lang }: SlotProps): JSX.Element {
  const tone = brief.cash.usdCliffActive ? colors.danger : colors.success
  const heading = lang === 'sw' ? 'Pesa na muda uliobaki' : 'Cash runway'
  const days = `${brief.cash.daysRemaining} ${lang === 'sw' ? 'siku' : 'days'}`
  const exposureLabel = lang === 'sw' ? 'USD-cliff' : 'USD exposure'
  return (
    <View testID="owner-dashboard-cash" style={[styles.slot, { borderLeftColor: tone }]}>
      <Text style={styles.slotTitle}>{heading}</Text>
      <Text style={styles.slotValue}>{days}</Text>
      <Text style={styles.slotMeta}>
        {`${exposureLabel}: ${formatCurrency(brief.cash.usdExposureTzs)}`}
      </Text>
    </View>
  )
}

function ComplianceSafetySlot({ brief, lang }: SlotProps): JSX.Element {
  const dangerous = brief.safety.openHighCount > 0 || brief.safety.licencesStatus === 'danger'
  const tone = dangerous ? colors.danger : colors.success
  const heading = lang === 'sw' ? 'Usalama na leseni' : 'Compliance & safety'
  const incidentLabel = lang === 'sw'
    ? `Matukio wazi (HIGH): ${brief.safety.openHighCount}`
    : `Open HIGH incidents: ${brief.safety.openHighCount}`
  const licenceLabel = lang === 'sw'
    ? brief.safety.licenceLabelSw
    : brief.safety.licenceLabelEn
  return (
    <View testID="owner-dashboard-safety" style={[styles.slot, { borderLeftColor: tone }]}>
      <Text style={styles.slotTitle}>{heading}</Text>
      <Text style={styles.slotMeta}>{incidentLabel}</Text>
      <Text style={styles.slotMeta}>{licenceLabel}</Text>
    </View>
  )
}

function QuickActionsSlot({ lang }: { readonly lang: 'sw' | 'en' }): JSX.Element {
  const heading = lang === 'sw' ? 'Vitendo vya haraka' : 'Quick actions'
  const labels = lang === 'sw'
    ? ['Idhinisha', 'Tuma ripoti', 'Anza upya leseni', 'Uliza Borjie']
    : ['Approve decisions', 'Send report', 'Renew licences', 'Ask Borjie']
  return (
    <View testID="owner-dashboard-actions" style={styles.slot}>
      <Text style={styles.slotTitle}>{heading}</Text>
      <View style={styles.actionsRow}>
        {labels.map((label) => (
          <View key={label} style={styles.actionChip}>
            <Text style={styles.actionChipText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  slot: {
    backgroundColor: colors.earth700,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.earth500,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  slotTitle: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.xs
  },
  slotValue: {
    color: colors.gold,
    fontSize: fontSize.h1,
    fontWeight: '800'
  },
  slotMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm
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
  }
})
