import { useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { useTranslation } from '@/hooks/useTranslation'
import { useSession } from '@/auth/session'
import { fetchListings, fetchBids } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { MarketplaceEmptyState } from '@/marketplace/home/MarketplaceEmptyState'
import { colors } from '@/theme/colors'
import { spacing } from '@/theme/spacing'
import { TrustBalanceStrip } from './sections/TrustBalanceStrip'
import { LiveAuctionLobby } from './sections/LiveAuctionLobby'
import { RecommendedParcels } from './sections/RecommendedParcels'
import { ActiveBidsSection } from './sections/ActiveBidsSection'
import { DealPipelineSection } from './sections/DealPipelineSection'
import { BuyerPerformanceSection } from './sections/BuyerPerformanceSection'

/**
 * Dashibodi — the buyer's at-a-glance dashboard. Six sections compose from
 * the same React Query caches that the marketplace and bids tabs already
 * hydrate, so navigation between tabs is free of redundant network calls.
 * Pure derivations live under `@/marketplace/home/*` so this screen stays
 * presentational and the dashboard / chat / future cards share one truth.
 */

export function BuyerDashboard() {
  const router = useRouter()
  const { t } = useTranslation()
  const user = useSession()

  const listingsQuery = useQuery({
    queryKey: queryKeys.listings({ sort: 'newest' }),
    queryFn: () => fetchListings({ sort: 'newest' })
  })
  const bidsQuery = useQuery({
    queryKey: queryKeys.bids(),
    queryFn: fetchBids
  })

  if (!user.id) {
    return (
      <Screen>
        <SectionHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
        <MarketplaceEmptyState message={t('dashboard.unauthenticated')} tone="warning" />
      </Screen>
    )
  }

  const isInitialLoad =
    (listingsQuery.isLoading && !listingsQuery.data) ||
    (bidsQuery.isLoading && !bidsQuery.data)
  const isFetching = listingsQuery.isFetching || bidsQuery.isFetching
  const isError = listingsQuery.isError || bidsQuery.isError

  const onRefresh = () => {
    void listingsQuery.refetch()
    void bidsQuery.refetch()
  }

  if (isInitialLoad) {
    return (
      <Screen>
        <SectionHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  if (isError) {
    return (
      <Screen refreshing={isFetching && !isInitialLoad} onRefresh={onRefresh}>
        <SectionHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
        <MarketplaceEmptyState message={t('dashboard.load_failed')} tone="error" />
      </Screen>
    )
  }

  const listings = listingsQuery.data ?? []
  const bids = bidsQuery.data ?? []

  return (
    <Screen refreshing={isFetching && !isInitialLoad} onRefresh={onRefresh}>
      <SectionHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      <View style={styles.gap}>
        <TrustBalanceStrip user={user} translate={t} />
      </View>

      <View style={styles.gap}>
        <LiveAuctionLobby
          listings={listings}
          translate={t}
          onPressListing={(id) => router.push(`/marketplace/${id}`)}
        />
      </View>

      <View style={styles.gap}>
        <RecommendedParcels
          listings={listings}
          translate={t}
          onPressListing={(id) => router.push(`/marketplace/${id}`)}
        />
      </View>

      <View style={styles.gap}>
        <ActiveBidsSection
          bids={bids}
          translate={t}
          onPressBid={(id) => router.push(`/bids/${id}`)}
        />
      </View>

      <View style={styles.gap}>
        <DealPipelineSection bids={bids} translate={t} />
      </View>

      <View style={styles.gap}>
        <BuyerPerformanceSection bids={bids} translate={t} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' },
  gap: { marginBottom: spacing.sm }
})
