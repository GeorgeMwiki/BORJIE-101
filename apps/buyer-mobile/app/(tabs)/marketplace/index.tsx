import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { fetchListings, fetchSellers, type ListingFilters } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { ListingCard } from '@/marketplace/ListingCard'
import { ListingFiltersBar } from '@/marketplace/ListingFilters'
import { SellerBrowseBar } from '@/marketplace/SellerBrowseBar'
import { WalletBar } from '@/marketplace/WalletBar'
import type { WalletCurrency } from '@/marketplace/walletFormat'
import { fetchWallet } from '@/api/wallet'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export default function MarketplaceIndex() {
  const router = useRouter()
  const { t } = useTranslation()
  const [filters, setFilters] = useState<ListingFilters>({ sort: 'newest' })
  const [search, setSearch] = useState('')
  const [walletSecondary, setWalletSecondary] = useState<WalletCurrency>('USD')

  const effectiveFilters: ListingFilters = { ...filters, search: search || undefined }
  const query = useQuery({
    queryKey: queryKeys.listings(effectiveFilters),
    queryFn: () => fetchListings(effectiveFilters)
  })

  // Real wallet snapshot. If the gateway endpoint is missing / errors we
  // HIDE the bar (see render below) rather than render fabricated zeros.
  // One retry is enough; a hard failure should not spam the gateway.
  const walletQuery = useQuery({
    queryKey: queryKeys.wallet(),
    queryFn: ({ signal }) => fetchWallet(signal),
    retry: 1,
    staleTime: 30_000
  })

  // Browse-by-mine rail — the seller orgs with buyer-visible listings.
  // On error / empty the rail renders nothing (SellerBrowseBar guards),
  // so the main listing browse is never blocked by it.
  const sellersQuery = useQuery({
    queryKey: queryKeys.marketplaceSellers(),
    queryFn: () => fetchSellers(),
    retry: 1,
    staleTime: 60_000
  })
  const sellers = sellersQuery.data ?? []

  const listings = query.data ?? []
  const isInitialLoad = query.isLoading && !query.data
  // Show the bar only while the real wallet is loading or has loaded.
  // On error (incl. 404 not-yet-shipped endpoint) render nothing — no
  // fake balances.
  const showWallet = walletQuery.isLoading || walletQuery.data !== undefined

  return (
    <Screen refreshing={query.isFetching && !isInitialLoad} onRefresh={() => query.refetch()}>
      {showWallet ? (
        <WalletBar
          snapshot={walletQuery.data ?? null}
          translate={t}
          secondary={walletSecondary}
          onSecondaryToggle={() =>
            setWalletSecondary((prev) => (prev === 'USD' ? 'KES' : 'USD'))
          }
        />
      ) : null}
      <SectionHeader title={t('marketplace.title')} subtitle={t('marketplace.subtitle')} />

      <SellerBrowseBar
        sellers={sellers}
        onSelect={(sellerTenantId) => router.push(`/marketplace/mine/${sellerTenantId}`)}
        translate={t}
      />

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t('marketplace.search_placeholder')}
        placeholderTextColor={colors.inkMuted}
        style={styles.search}
      />

      <ListingFiltersBar filters={filters} onChange={setFilters} translate={t} />

      {isInitialLoad ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      ) : query.isError ? (
        <EmptyState message={t('marketplace.load_failed')} />
      ) : listings.length === 0 ? (
        <EmptyState message={t('marketplace.empty')} />
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
  search: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    marginBottom: spacing.md,
    ...typography.body
  },
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' }
})
