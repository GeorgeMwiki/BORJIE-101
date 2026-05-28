import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import {
  formatResponseLatency,
  summariseBuyerPerformance
} from '@/marketplace/home/performance'
import { formatTzs } from '@/components/formatters'
import { tokens } from '@/ui-litfin'
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
  title: { ...tokens.type.h3, color: tokens.color.textPrimary },
  subtitle: { ...tokens.type.bodySm, color: tokens.color.textMuted, marginTop: 2, marginBottom: tokens.space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: tokens.space.sm },
  stat: {
    flex: 1,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    backgroundColor: tokens.color.bgBase,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: 'center'
  },
  statValue: { ...tokens.type.bodyStrong, color: tokens.color.gold },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: tokens.color.textMuted,
    marginTop: 4,
    textTransform: 'uppercase',
    textAlign: 'center'
  },
  footer: {
    marginTop: tokens.space.md,
    paddingTop: tokens.space.md,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border
  },
  footerText: { ...tokens.type.bodySm, color: tokens.color.textMuted }
})
