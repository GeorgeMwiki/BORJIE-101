import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { fetchListings, type ListingFilters } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { ListingCard } from '@/marketplace/ListingCard'
import { ListingFiltersBar } from '@/marketplace/ListingFilters'
import { WalletBar, type WalletSnapshot } from '@/marketplace/WalletBar'
import type { WalletCurrency } from '@/marketplace/walletFormat'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

/**
 * Stub wallet snapshot used until the buyer-wallet endpoint ships.
 * Per Borjie hard rule we never hard-code real FX rates — these
 * values are explicit placeholder constants that the gateway will
 * replace once `/v1/mining/buyers/wallet` lands (G3 roadmap item:
 * full endpoint wiring is sibling-owned).
 */
const WALLET_STUB: WalletSnapshot = {
  tzs: 0,
  usd: 0,
  kes: 0,
  fxRates: {
    usdPerTzs: 0,
    kesPerTzs: 0,
    capturedAt: new Date(0).toISOString() // epoch — guaranteed stale UI cue
  }
}

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

  const listings = query.data ?? []
  const isInitialLoad = query.isLoading && !query.data

  return (
    <Screen refreshing={query.isFetching && !isInitialLoad} onRefresh={() => query.refetch()}>
      <WalletBar
        snapshot={WALLET_STUB}
        translate={t}
        secondary={walletSecondary}
        onSecondaryToggle={() =>
          setWalletSecondary((prev) => (prev === 'USD' ? 'KES' : 'USD'))
        }
      />
      <SectionHeader title={t('marketplace.title')} subtitle={t('marketplace.subtitle')} />

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
