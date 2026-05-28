import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { MarketplaceEmptyState } from '@/marketplace/home/MarketplaceEmptyState'
import { selectLiveLobby } from '@/marketplace/home/derivations'
import { formatKg, formatTzs } from '@/components/formatters'
import { tokens } from '@/ui-litfin'
import type { Listing } from '@/types/listing'

export interface LiveAuctionLobbyProps {
  readonly listings: readonly Listing[]
  readonly translate: (key: string) => string
  readonly onPressListing: (id: string) => void
}

export function LiveAuctionLobby({ listings, translate, onPressListing }: LiveAuctionLobbyProps) {
  const lobby = selectLiveLobby(listings, 4)
  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title}>{translate('dashboard.live_lobby')}</Text>
        <Pill label={translate('dashboard.live')} tone="success" />
      </View>
      {lobby.length === 0 ? (
        <MarketplaceEmptyState message={translate('dashboard.no_live')} />
      ) : (
        <View style={styles.list}>
          {lobby.map((listing) => (
            <View key={listing.id} style={styles.row}>
              <View style={styles.main}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {listing.title}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {listing.originRegion} · {formatKg(listing.quantityKg)}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space.md
  },
  title: { ...tokens.type.h3, color: tokens.color.textPrimary },
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
