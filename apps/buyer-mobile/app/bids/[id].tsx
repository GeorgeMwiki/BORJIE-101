import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill, PillTone } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { findBid } from '@/mocks/bids'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import type { BidStatus } from '@/types/listing'

const toneByStatus: Record<BidStatus, PillTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  countered: 'gold'
}

export default function BidDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useTranslation()
  const bid = findBid(String(id))

  if (!bid) {
    return (
      <Screen>
        <EmptyState message={t('bids.empty')} />
      </Screen>
    )
  }

  return (
    <Screen>
      <SectionHeader title={bid.listingTitle} subtitle={t('bids.subtitle')} />

      <Card>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>{t('bids.your_offer')}</Text>
          <Pill label={t(`bids.status.${bid.status}`)} tone={toneByStatus[bid.status]} />
        </View>
        <KeyValueRow label={t('bids.your_offer')} value={`${formatTzs(bid.offerTzsPerKg)} / ${t('common.kg')}`} />
        <KeyValueRow label={t('marketplace.quantity')} value={formatKg(bid.quantityKg)} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('bids.thread')}</Text>
        {bid.thread.map((msg) => (
          <View
            key={msg.id}
            style={[styles.bubble, msg.from === 'buyer' ? styles.bubbleBuyer : styles.bubbleSeller]}
          >
            <Text style={styles.bubbleAuthor}>{msg.from === 'buyer' ? 'You' : 'Seller'}</Text>
            <Text style={styles.bubbleBody}>{msg.body}</Text>
          </View>
        ))}
      </Card>

      <View style={{ marginTop: spacing.md }}>
        <PrimaryButton label={t('bids.send_message')} onPress={() => undefined} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.sm },
  bubble: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.line },
  bubbleBuyer: { backgroundColor: colors.cream, alignSelf: 'flex-end', maxWidth: '85%' },
  bubbleSeller: { backgroundColor: colors.bone, alignSelf: 'flex-start', maxWidth: '85%' },
  bubbleAuthor: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase', marginBottom: 2 },
  bubbleBody: { ...typography.body, color: colors.ink }
})
