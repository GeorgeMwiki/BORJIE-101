import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill, type PillTone } from '@/components/Pill'
import { MarketplaceEmptyState } from '@/marketplace/home/MarketplaceEmptyState'
import { selectActiveBids } from '@/marketplace/home/derivations'
import { formatTzs } from '@/components/formatters'
import { tokens } from '@/ui-litfin'
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
  title: { ...tokens.type.h3, color: tokens.color.textPrimary, marginBottom: tokens.space.md },
  list: { gap: tokens.space.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    backgroundColor: tokens.color.bgBase,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border
  },
  main: { flex: 1, paddingRight: tokens.space.md },
  rowTitle: { ...tokens.type.bodyStrong, color: tokens.color.textPrimary },
  rowMeta: { ...tokens.type.bodySm, color: tokens.color.textMuted, marginTop: 2 },
  actions: { alignItems: 'flex-end', gap: tokens.space.xs },
  link: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: tokens.color.gold,
    textTransform: 'uppercase'
  }
})
