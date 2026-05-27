import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { summarisePipeline } from '@/marketplace/home/derivations'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import type { Bid } from '@/types/listing'

export interface DealPipelineSectionProps {
  readonly bids: readonly Bid[]
  readonly translate: (key: string) => string
}

export function DealPipelineSection({ bids, translate }: DealPipelineSectionProps) {
  const summary = summarisePipeline(bids)
  return (
    <Card>
      <Text style={styles.title}>{translate('dashboard.pipeline')}</Text>
      <Text style={styles.subtitle}>{translate('dashboard.pipeline_subtitle')}</Text>
      <View style={styles.row}>
        <Stat label={translate('dashboard.pipeline_kyc')} value={summary.negotiating} />
        <Stat label={translate('dashboard.pipeline_payment')} value={summary.accepted} />
        <Stat label={translate('dashboard.pipeline_dispatch')} value={summary.closed} />
        <Stat label={translate('documents.total')} value={summary.total} />
      </View>
    </Card>
  )
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
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
  statValue: { ...typography.title, color: colors.forest },
  statLabel: {
    ...typography.micro,
    color: colors.inkMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    textAlign: 'center'
  }
})
