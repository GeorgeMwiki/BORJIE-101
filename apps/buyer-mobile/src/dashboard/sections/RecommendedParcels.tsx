import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { MarketplaceEmptyState } from '@/marketplace/home/MarketplaceEmptyState'
import { selectRecommended } from '@/marketplace/home/derivations'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import type { Listing } from '@/types/listing'

export interface RecommendedParcelsProps {
  readonly listings: readonly Listing[]
  readonly translate: (key: string) => string
  readonly onPressListing: (id: string) => void
}

export function RecommendedParcels({ listings, translate, onPressListing }: RecommendedParcelsProps) {
  const ranked = selectRecommended(listings, 5)
  return (
    <Card>
      <Text style={styles.title}>{translate('dashboard.recommended')}</Text>
      {ranked.length === 0 ? (
        <MarketplaceEmptyState message={translate('dashboard.no_recommended')} />
      ) : (
        <View style={styles.list}>
          {ranked.map((listing) => (
            <View key={listing.id} style={styles.row}>
              <View style={styles.main}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {listing.title}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {listing.originRegion} · {formatKg(listing.quantityKg)} ·{' '}
                  {listing.seller.name}
                </Text>
              </View>
              <Text style={styles.rowPrice} onPress={() => onPressListing(listing.id)}>
                {formatTzs(listing.priceHintTzs)}
              </Text>
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
  rowPrice: { ...typography.bodyStrong, color: colors.forest }
})
