import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { MarketplaceEmptyState } from '@/marketplace/home/MarketplaceEmptyState'
import { selectLiveLobby } from '@/marketplace/home/derivations'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
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
    marginBottom: spacing.md
  },
  title: { ...typography.heading, color: colors.ink },
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
