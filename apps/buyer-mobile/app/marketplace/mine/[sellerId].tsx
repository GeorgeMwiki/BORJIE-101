import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { fetchListings, type ListingFilters } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { ListingCard } from '@/marketplace/ListingCard'
import { colors } from '@/theme/colors'
import { spacing } from '@/theme/spacing'

/**
 * Owner-scoped marketplace — "buy from this mine".
 *
 * Deep-linkable buyer surface for ONE seller org: renders only that
 * mine's buyer-visible active listings (the gateway `sellerTenantId`
 * filter never exposes a private parcel) and drills into the shared
 * `/marketplace/[id]` detail + PlaceBidSheet flow. The mine name is
 * read off the listings' joined `sellerName`.
 */
export default function SellerMarketplace() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>()
  const router = useRouter()
  const { t } = useTranslation()
  const sellerTenantId = String(sellerId)

  const filters: ListingFilters = { sort: 'newest', sellerTenantId }
  const query = useQuery({
    queryKey: queryKeys.listings(filters),
    queryFn: () => fetchListings(filters),
    enabled: sellerTenantId.length > 0
  })

  const listings = query.data ?? []
  const isInitialLoad = query.isLoading && !query.data
  // Attribute the mine from the first listing's joined seller name.
  const mineName =
    listings.find((l) => l.sellerName && l.sellerName.length > 0)?.sellerName ??
    t('marketplace.this_mine')

  return (
    <Screen
      refreshing={query.isFetching && !isInitialLoad}
      onRefresh={() => void query.refetch()}
    >
      <SectionHeader title={mineName} subtitle={t('marketplace.from_mine_subtitle')} />

      {isInitialLoad ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      ) : query.isError ? (
        <EmptyState message={t('marketplace.load_failed')} />
      ) : listings.length === 0 ? (
        <EmptyState message={t('marketplace.mine_empty')} />
      ) : (
        listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            onPress={() => router.push(`/marketplace/${listing.id}`)}
            translate={t}
          />
        ))
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' }
})
