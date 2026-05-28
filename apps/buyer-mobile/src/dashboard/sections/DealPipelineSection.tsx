import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { summarisePipeline } from '@/marketplace/home/derivations'
import { tokens } from '@/ui-litfin'
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
  statValue: { ...tokens.type.h2, color: tokens.color.gold },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: tokens.color.textMuted,
    marginTop: 4,
    textTransform: 'uppercase',
    textAlign: 'center'
  }
})
