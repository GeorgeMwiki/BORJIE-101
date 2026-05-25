import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { findListing } from '@/mocks/listings'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export default function MarketplaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { t } = useTranslation()
  const listing = findListing(String(id))

  if (!listing) {
    return (
      <Screen>
        <EmptyState message={t('marketplace.empty')} />
      </Screen>
    )
  }

  return (
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
        <KeyValueRow label={t('marketplace.price_hint')} value={`${formatTzs(listing.priceTzsPerKg)} / ${t('common.kg')}`} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('marketplace.seller_rating')}</Text>
        <View style={styles.sellerRow}>
          <Text style={styles.sellerName}>{listing.seller.name}</Text>
          <Pill label={listing.seller.verified ? 'verified' : 'unverified'} tone={listing.seller.verified ? 'success' : 'warning'} />
        </View>
        <Text style={styles.meta}>PML {listing.seller.pmlNumber} · {listing.seller.rating.toFixed(1)} / 5</Text>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Assay</Text>
        {listing.assayResults.map((result) => (
          <KeyValueRow key={result.element} label={`${result.element} (${result.method})`} value={result.grade} />
        ))}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('marketplace.chain_of_custody')}</Text>
        {listing.chainOfCustody.map((step, idx) => (
          <Text key={step} style={styles.custodyStep}>
            {idx + 1}. {step}
          </Text>
        ))}
      </Card>

      <View style={styles.actions}>
        <PrimaryButton label={t('marketplace.view_assay')} variant="ghost" onPress={() => undefined} />
        <View style={{ height: spacing.md }} />
        <PrimaryButton label={t('marketplace.place_bid')} variant="primary" onPress={() => router.push('/bids')} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  photos: { marginBottom: spacing.lg },
  photo: { width: 240, height: 160, borderRadius: radius.lg, marginRight: spacing.md, backgroundColor: colors.sand },
  cardTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.sm },
  sellerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sellerName: { ...typography.bodyStrong, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs },
  custodyStep: { ...typography.body, color: colors.inkSoft, marginVertical: 2 },
  actions: { marginTop: spacing.lg }
})
