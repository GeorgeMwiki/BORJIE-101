import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { MarketplaceEmptyState } from '@/marketplace/home/MarketplaceEmptyState'
import { selectRecommended } from '@/marketplace/home/derivations'
import { formatKg, formatTzs } from '@/components/formatters'
import { tokens } from '@/ui-litfin'
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
  rowPrice: { ...tokens.type.bodyStrong, color: tokens.color.gold }
})
