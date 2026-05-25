import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { Pill, PillTone } from '@/components/Pill'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { mockBids } from '@/mocks/bids'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'
import type { BidStatus } from '@/types/listing'

const toneByStatus: Record<BidStatus, PillTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  countered: 'gold'
}

export default function BidsIndex() {
  const router = useRouter()
  const { t } = useTranslation()

  if (mockBids.length === 0) {
    return (
      <Screen>
        <SectionHeader title={t('bids.title')} subtitle={t('bids.subtitle')} />
        <EmptyState message={t('bids.empty')} />
      </Screen>
    )
  }

  return (
    <Screen>
      <SectionHeader title={t('bids.title')} subtitle={t('bids.subtitle')} />
      {mockBids.map((bid) => (
        <Card key={bid.id} onPress={() => router.push(`/bids/${bid.id}`)}>
          <View style={styles.row}>
            <Text style={styles.title}>{bid.listingTitle}</Text>
            <Pill label={t(`bids.status.${bid.status}`)} tone={toneByStatus[bid.status]} />
          </View>
          <View style={styles.statRow}>
            <View>
              <Text style={styles.statLabel}>{t('bids.your_offer')}</Text>
              <Text style={styles.statValue}>{formatTzs(bid.offerTzsPerKg)} / {t('common.kg')}</Text>
            </View>
            <View>
              <Text style={styles.statLabel}>{t('marketplace.quantity')}</Text>
              <Text style={styles.statValue}>{formatKg(bid.quantityKg)}</Text>
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
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  statLabel: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase' },
  statValue: { ...typography.bodyStrong, color: colors.ink, marginTop: 2 }
})
