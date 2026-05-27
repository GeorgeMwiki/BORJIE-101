import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill, type PillTone } from '@/components/Pill'
import { MarketplaceEmptyState } from '@/marketplace/home/MarketplaceEmptyState'
import { selectActiveBids } from '@/marketplace/home/derivations'
import { formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import type { Bid, BidStatus } from '@/types/listing'

export interface ActiveBidsSectionProps {
  readonly bids: readonly Bid[]
  readonly translate: (key: string) => string
  readonly onPressBid: (id: string) => void
}

const STATUS_TONE: Readonly<Record<BidStatus, PillTone>> = {
  pending: 'warning',
  countered: 'gold',
  accepted: 'success',
  rejected: 'danger'
}

export function ActiveBidsSection({ bids, translate, onPressBid }: ActiveBidsSectionProps) {
  const active = selectActiveBids(bids, 5)
  return (
    <Card>
      <Text style={styles.title}>{translate('dashboard.active_bids')}</Text>
      {active.length === 0 ? (
        <MarketplaceEmptyState message={translate('bids.empty')} />
      ) : (
        <View style={styles.list}>
          {active.map((bid) => (
            <View key={bid.id} style={styles.row}>
              <View style={styles.main}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {bid.listingTitle}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {translate('bids.your_offer')}:{' '}
                  {formatTzs(bid.offerTzsPerKg * bid.quantityKg)}
                </Text>
              </View>
              <View style={styles.actions}>
                <Pill label={translate(`bids.status.${bid.status}`)} tone={STATUS_TONE[bid.status]} />
                <Text style={styles.link} onPress={() => onPressBid(bid.id)}>
                  {translate('bids.thread')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  title: { ...typography.heading, color: colors.ink, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cream,
    borderRadius: radius.md
  },
  main: { flex: 1, paddingRight: spacing.md },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  actions: { alignItems: 'flex-end', gap: spacing.xs },
  link: { ...typography.micro, color: colors.forest, textTransform: 'uppercase' }
})
