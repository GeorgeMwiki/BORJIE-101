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
import { AskSellerSheet } from '@/components/AskSellerSheet'
import { useTranslation } from '@/hooks/useTranslation'
import { useSession } from '@/auth/session'
import { isCrossTenantListing } from '@/marketplace/crossTenant'
import { fetchListing } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { formatKg, formatTzs } from '@/components/formatters'
// formatKm is available in @/marketplace/distance; re-import when
// the gateway adds distanceKm to the Listing shape.
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export default function MarketplaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useTranslation()
  const session = useSession()
  const [bidVisible, setBidVisible] = useState(false)
  const [inquiryVisible, setInquiryVisible] = useState(false)
  const listingId = String(id)

  const query = useQuery({
    queryKey: queryKeys.listing(listingId),
    queryFn: () => fetchListing(listingId)
  })

  if (query.isLoading) {
    return (
      <Screen>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('marketplace.loading')}
          style={styles.loader}
        >
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  if (query.isError && !query.data) {
    return (
      <Screen>
        <Card>
          <Text style={styles.cardTitle}>{t('marketplace.load_failed')}</Text>
          <View style={{ marginTop: spacing.sm }}>
            <PrimaryButton
              label={t('common.retry')}
              variant="ghost"
              onPress={() => void query.refetch()}
            />
          </View>
        </Card>
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

  // KI-006 — a cross-tenant listing is browse-only for bids (place-bid is
  // intra-tenant and would 404). Offer the inquiry path instead. Fail-closed
  // when either tenant is unknown (see isCrossTenantListing).
  const crossTenant = isCrossTenantListing(listing, session.tenantId)

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
          {/* distance is omitted until the gateway returns real geocoded data */}
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
          {crossTenant ? (
            <>
              <Text style={styles.crossTenantNote}>{t('inquiry.cross_tenant_note')}</Text>
              <PrimaryButton
                label={t('inquiry.ask_seller')}
                variant="primary"
                onPress={() => setInquiryVisible(true)}
              />
            </>
          ) : (
            <PrimaryButton
              label={t('marketplace.place_bid')}
              variant="primary"
              onPress={() => setBidVisible(true)}
            />
          )}
        </View>
      </Screen>

      {crossTenant ? (
        <AskSellerSheet
          visible={inquiryVisible}
          onClose={() => setInquiryVisible(false)}
          listing={listing}
        />
      ) : (
        <PlaceBidSheet visible={bidVisible} onClose={() => setBidVisible(false)} listing={listing} />
      )}
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
  crossTenantNote: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.sm },
  loader: { paddingTop: spacing.xxxl, alignItems: 'center' }
})
