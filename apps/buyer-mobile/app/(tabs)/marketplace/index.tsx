import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { mockListings } from '@/mocks/listings'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export default function MarketplaceIndex() {
  const router = useRouter()
  const { t } = useTranslation()

  if (mockListings.length === 0) {
    return (
      <Screen>
        <SectionHeader title={t('marketplace.title')} subtitle={t('marketplace.subtitle')} />
        <EmptyState message={t('marketplace.empty')} />
      </Screen>
    )
  }

  return (
    <Screen>
      <SectionHeader title={t('marketplace.title')} subtitle={t('marketplace.subtitle')} />
      {mockListings.map((listing) => (
        <Card key={listing.id} onPress={() => router.push(`/marketplace/${listing.id}`)}>
          <View style={styles.row}>
            <Text style={styles.title}>{listing.title}</Text>
            {listing.status === 'reserved' ? <Pill label="reserved" tone="warning" /> : <Pill label="open" tone="success" />}
          </View>
          <Text style={styles.meta}>
            {listing.originRegion} · {listing.seller.name}
          </Text>
          <View style={styles.statRow}>
            <View>
              <Text style={styles.statLabel}>{t('marketplace.grade')}</Text>
              <Text style={styles.statValue}>{listing.grade}</Text>
            </View>
            <View>
              <Text style={styles.statLabel}>{t('marketplace.quantity')}</Text>
              <Text style={styles.statValue}>{formatKg(listing.quantityKg)}</Text>
            </View>
            <View>
              <Text style={styles.statLabel}>{t('marketplace.price_hint')}</Text>
              <Text style={styles.statValue}>{formatTzs(listing.priceHintTzs)}</Text>
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.heading, color: colors.ink, flexShrink: 1, paddingRight: spacing.sm },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  statLabel: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase' },
  statValue: { ...typography.bodyStrong, color: colors.ink, marginTop: 2 }
})
