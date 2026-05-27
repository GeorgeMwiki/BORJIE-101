import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill, PillTone } from '@/components/Pill'
import { selectActiveBids } from '@/marketplace/home/derivations'
import { formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import type { Bid, Mineral } from '@/types/listing'
import { BidsResultSchema, type BidSnapshot } from '../toolPayloads'

export interface ActiveBidsCardProps {
  readonly payload: unknown
  readonly translate: (key: string) => string
}

const STATUS_TONE: Readonly<Record<Bid['status'], PillTone>> = {
  pending: 'warning',
  countered: 'gold',
  accepted: 'success',
  rejected: 'danger'
}

// `bids.active` tool. Picks the buyer's most recent pending/countered
// bids using the existing `selectActiveBids` derivation.

export function ActiveBidsCard({ payload, translate }: ActiveBidsCardProps) {
  const router = useRouter()
  const parsed = BidsResultSchema.safeParse(payload)
  if (!parsed.success) {
    return null
  }
  const bids = parsed.data.bids.map(toBid)
  const active = selectActiveBids(bids, 5)
  if (active.length === 0) {
    return (
      <Card>
        <Text style={styles.empty}>{translate('bids.empty')}</Text>
      </Card>
    )
  }
  return (
    <Card>
      <Text style={styles.title}>{translate('bids.title')}</Text>
      <View style={styles.list}>
        {active.map((bid) => (
          <View key={bid.id} style={styles.row}>
            <View style={styles.main}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {bid.listingTitle}
              </Text>
              <Text style={styles.rowMeta}>
                {translate('bids.your_offer')}: {formatTzs(bid.offerTzsPerKg * bid.quantityKg)}
              </Text>
            </View>
            <View style={styles.actions}>
              <Pill label={translate(`bids.status.${bid.status}`)} tone={STATUS_TONE[bid.status]} />
              <Text style={styles.link} onPress={() => router.push(`/bids/${bid.id}`)}>
                {translate('bids.thread')}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  )
}

function toBid(raw: BidSnapshot): Bid {
  return {
    id: raw.id,
    listingId: raw.listingId,
    listingTitle: raw.listingTitle,
    mineral: raw.mineral as Mineral,
    offerTzsPerKg: raw.offerTzsPerKg,
    quantityKg: raw.quantityKg,
    status: raw.status,
    placedAt: raw.placedAt,
    thread: raw.thread
  }
}

const styles = StyleSheet.create({
  title: { ...typography.heading, color: colors.ink, marginBottom: spacing.md },
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
  main: { flex: 1, paddingRight: spacing.md },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  actions: { alignItems: 'flex-end', gap: spacing.xs },
  link: { ...typography.micro, color: colors.forest, textTransform: 'uppercase' },
  empty: { ...typography.caption, color: colors.inkMuted }
})
