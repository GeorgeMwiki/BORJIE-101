import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { SectionHeader } from '@/components/SectionHeader'
import { ListingCard } from '@/marketplace/ListingCard'
import { selectRecommended } from '@/marketplace/home/derivations'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'
import type { Listing, Mineral } from '@/types/listing'
import { MarketplaceListingsResultSchema, type MarketplaceListing } from '../toolPayloads'

export interface RecommendedListingsCardProps {
  readonly payload: unknown
  readonly translate: (key: string) => string
}

// `marketplace.recommended` tool. We delegate ranking to the existing
// pure `selectRecommended` helper so the chat card and a future grid
// surface share one sort definition.

export function RecommendedListingsCard({ payload, translate }: RecommendedListingsCardProps) {
  const router = useRouter()
  const parsed = MarketplaceListingsResultSchema.safeParse(payload)
  if (!parsed.success) {
    return null
  }
  const listings = parsed.data.listings.map(toListing)
  const ranked = selectRecommended(listings, 5)
  if (ranked.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{translate('marketplace.empty')}</Text>
      </View>
    )
  }
  return (
    <View style={styles.wrap}>
      <SectionHeader title={translate('marketplace.title')} subtitle={translate('marketplace.subtitle')} />
      {ranked.map((listing) => (
        <ListingCard
          key={listing.id}
          listing={listing}
          onPress={() => router.push(`/marketplace/${listing.id}`)}
          translate={translate}
        />
      ))}
    </View>
  )
}

function toListing(raw: MarketplaceListing): Listing {
  return {
    id: raw.id,
    mineral: raw.mineral as Mineral,
    title: raw.title,
    grade: raw.grade,
    quantityKg: raw.quantityKg,
    originSite: raw.originSite,
    originRegion: raw.originRegion,
    seller: {
      id: raw.seller.id,
      name: raw.seller.name,
      pmlNumber: raw.seller.pmlNumber,
      rating: raw.seller.rating,
      verified: raw.seller.verified
    },
    priceTzsPerKg: raw.priceTzsPerKg,
    priceHintTzs: raw.priceHintTzs,
    photos: raw.photos,
    assayPdfUrl: raw.assayPdfUrl,
    assayResults: [],
    chainOfCustody: raw.chainOfCustody,
    listedAt: raw.listedAt,
    status: raw.status
  }
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  empty: { paddingVertical: spacing.md },
  emptyText: { ...typography.caption, color: colors.inkMuted }
})
