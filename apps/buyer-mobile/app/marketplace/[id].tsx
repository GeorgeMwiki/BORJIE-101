import { useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { EmptyState } from '@/components/EmptyState'
import { PdfViewer } from '@/components/PdfViewer'
import { Timeline } from '@/components/Timeline'
import { PlaceBidSheet } from '@/components/PlaceBidSheet'
import { useTranslation } from '@/hooks/useTranslation'
import { fetchListing } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { formatKg, formatTzs } from '@/components/formatters'
import { mockDistanceKm, formatKm } from '@/marketplace/distance'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export default function MarketplaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useTranslation()
  const [bidVisible, setBidVisible] = useState(false)
  const listingId = String(id)

  const query = useQuery({
    queryKey: queryKeys.listing(listingId),
    queryFn: () => fetchListing(listingId)
  })

  if (query.isLoading) {
    return (
      <Screen>
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  const listing = query.data
  if (!listing) {
    return (
      <Screen>
        <EmptyState message={t('marketplace.empty')} />
      </Screen>
    )
  }

  const timelineItems = listing.chainOfCustody.map((step, idx) => ({
    id: `step-${idx}`,
    title: step
  }))

  return (
    <>
      <Screen>
        <SectionHeader title={listing.title} subtitle={`${listing.originSite} · ${listing.originRegion}`} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photos}>
          {listing.photos.map((url) => (
            <Image key={url} source={{ uri: url }} style={styles.photo} />
          ))}
        </ScrollView>

        <Card>
          <KeyValueRow label={t('marketplace.grade')} value={listing.grade} />
          <KeyValueRow label={t('marketplace.quantity')} value={formatKg(listing.quantityKg)} />
          <KeyValueRow label={t('marketplace.origin')} value={listing.originSite} />
          <KeyValueRow label={t('marketplace.distance')} value={formatKm(mockDistanceKm(listing.originRegion))} />
          <KeyValueRow
            label={t('marketplace.price_hint')}
            value={`${formatTzs(listing.priceTzsPerKg)} / ${t('common.kg')}`}
          />
        </Card>

        <Card>
          <Text style={styles.cardTitle}>{t('marketplace.seller_rating')}</Text>
          <View style={styles.sellerRow}>
            <Text style={styles.sellerName}>{listing.seller.name}</Text>
            <Pill
              label={listing.seller.verified ? 'verified' : 'unverified'}
              tone={listing.seller.verified ? 'success' : 'warning'}
            />
          </View>
          <Text style={styles.meta}>
            PML {listing.seller.pmlNumber} · {listing.seller.rating.toFixed(1)} / 5
          </Text>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Assay</Text>
          {listing.assayResults.map((result) => (
            <KeyValueRow
              key={result.element}
              label={`${result.element} (${result.method})`}
              value={result.grade}
            />
          ))}
          <View style={{ marginTop: spacing.md }}>
            <PdfViewer url={listing.assayPdfUrl} title="Assay PDF" />
          </View>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>{t('marketplace.chain_of_custody')}</Text>
          <Timeline items={timelineItems} />
        </Card>

        <View style={styles.bottomCta}>
          <PrimaryButton
            label={t('marketplace.place_bid')}
            variant="primary"
            onPress={() => setBidVisible(true)}
          />
        </View>
      </Screen>

      <PlaceBidSheet visible={bidVisible} onClose={() => setBidVisible(false)} listing={listing} />
    </>
  )
}

const styles = StyleSheet.create({
  photos: { marginBottom: spacing.lg },
  photo: {
    width: 240,
    height: 160,
    borderRadius: radius.lg,
    marginRight: spacing.md,
    backgroundColor: colors.sand
  },
  cardTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.sm },
  sellerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sellerName: { ...typography.bodyStrong, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs },
  bottomCta: { marginTop: spacing.lg, marginBottom: spacing.xxl },
  loader: { paddingTop: spacing.xxxl, alignItems: 'center' }
})
