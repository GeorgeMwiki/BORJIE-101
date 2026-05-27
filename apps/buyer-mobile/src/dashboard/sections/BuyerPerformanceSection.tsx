import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import {
  formatResponseLatency,
  summariseBuyerPerformance
} from '@/marketplace/home/performance'
import { formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import type { Bid } from '@/types/listing'

export interface BuyerPerformanceSectionProps {
  readonly bids: readonly Bid[]
  readonly translate: (key: string) => string
}

export function BuyerPerformanceSection({ bids, translate }: BuyerPerformanceSectionProps) {
  const summary = summariseBuyerPerformance(bids)
  return (
    <Card>
      <Text style={styles.title}>{translate('dashboard.performance')}</Text>
      <Text style={styles.subtitle}>{translate('dashboard.performance_subtitle')}</Text>
      <View style={styles.row}>
        <Stat label={translate('dashboard.win_rate')} value={`${summary.winRatePct}%`} />
        <Stat
          label={translate('dashboard.response_time')}
          value={formatResponseLatency(summary.medianResponseMs)}
        />
        <Stat label={translate('dashboard.deal_volume')} value={formatTzs(summary.dealVolumeTzs)} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {translate('dashboard.bids_placed')}: {summary.bidsPlaced} ·{' '}
          {translate('dashboard.bids_accepted')}: {summary.bidsAccepted}
        </Text>
      </View>
    </Card>
  )
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  title: { ...typography.heading, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.inkMuted, marginTop: 2, marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  stat: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  statValue: { ...typography.bodyStrong, color: colors.forest },
  statLabel: {
    ...typography.micro,
    color: colors.inkMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    textAlign: 'center'
  },
  footer: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  footerText: { ...typography.caption, color: colors.inkMuted }
})
