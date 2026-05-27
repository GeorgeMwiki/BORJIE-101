import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { selectLiveLobby } from '@/marketplace/home/derivations'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import type { Listing, Mineral } from '@/types/listing'
import { MarketplaceListingsResultSchema, type MarketplaceListing } from '../toolPayloads'

export interface LiveLobbyCardProps {
  readonly payload: unknown
  readonly translate: (key: string) => string
}

// `marketplace.lobby` tool. Renders a compact horizontal lobby of
// freshly-listed open parcels — pressed rows deep-link into the parcel
// detail screen.

export function LiveLobbyCard({ payload, translate }: LiveLobbyCardProps) {
  const router = useRouter()
  const parsed = MarketplaceListingsResultSchema.safeParse(payload)
  if (!parsed.success) {
    return null
  }
  const listings = parsed.data.listings.map(toListing)
  const lobby = selectLiveLobby(listings, 4)
  if (lobby.length === 0) {
    return null
  }
  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title}>{translate('marketplace.title')}</Text>
        <Pill label="LIVE" tone="success" />
      </View>
      <View style={styles.list}>
        {lobby.map((listing) => (
          <View key={listing.id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {listing.title}
              </Text>
              <Text style={styles.rowMeta}>
                {listing.originRegion} · {formatKg(listing.quantityKg)}
              </Text>
            </View>
            <Text style={styles.rowPrice} onPress={() => router.push(`/marketplace/${listing.id}`)}>
              {formatTzs(listing.priceHintTzs)}
            </Text>
          </View>
        ))}
      </View>
    </Card>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
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
  rowMain: { flex: 1, paddingRight: spacing.md },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  rowPrice: { ...typography.bodyStrong, color: colors.forest }
})
