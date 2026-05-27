import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import { DealPipelineResultSchema } from '../toolPayloads'

export interface DealPipelineCardProps {
  readonly payload: unknown
  readonly translate: (key: string) => string
}

// `deals.pipeline` tool. Three-bucket kanban summary fed by the
// `summarisePipeline` derivation on the gateway side. Kept rendering-only.

export function DealPipelineCard({ payload, translate }: DealPipelineCardProps) {
  const parsed = DealPipelineResultSchema.safeParse(payload)
  if (!parsed.success) {
    return null
  }
  const { negotiating, accepted, closed, total } = parsed.data
  return (
    <Card>
      <Text style={styles.title}>{translate('bids.title')}</Text>
      <Text style={styles.subtitle}>{translate('bids.subtitle')}</Text>
      <View style={styles.row}>
        <Stat label={translate('bids.status.pending')} value={negotiating} />
        <Stat label={translate('bids.status.accepted')} value={accepted} />
        <Stat label={translate('bids.status.rejected')} value={closed} />
        <Stat label={translate('documents.total')} value={total} />
      </View>
    </Card>
  )
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  statLabel: { ...typography.micro, color: colors.inkMuted, marginTop: 2, textTransform: 'uppercase' }
})
