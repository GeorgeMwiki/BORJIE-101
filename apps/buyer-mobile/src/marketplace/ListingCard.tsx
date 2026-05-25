import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { formatKg, formatTzs } from '@/components/formatters'
import { mockDistanceKm, formatKm } from './distance'
import { mineralGlyph } from './options'
import { colors } from '@/theme/colors'
import { spacing, typography, radius } from '@/theme/spacing'
import type { Listing } from '@/types/listing'

export interface ListingCardProps {
  readonly listing: Listing
  readonly onPress: () => void
  readonly translate: (key: string) => string
}

export function ListingCard({ listing, onPress, translate }: ListingCardProps) {
  return (
    <Card onPress={onPress}>
      <View style={styles.headerRow}>
        <View style={styles.glyphWrap}>
          <Text style={styles.glyph}>{mineralGlyph[listing.mineral]}</Text>
        </View>
        <View style={styles.headerBody}>
          <Text style={styles.title} numberOfLines={2}>
            {listing.title}
          </Text>
          <Text style={styles.meta}>
            {listing.originRegion} · {listing.seller.name}
          </Text>
        </View>
        {listing.status === 'reserved' ? (
          <Pill label="reserved" tone="warning" />
        ) : (
          <Pill label="open" tone="success" />
        )}
      </View>

      <View style={styles.statRow}>
        <Stat label={translate('marketplace.grade')} value={listing.grade} />
        <Stat label={translate('marketplace.quantity')} value={formatKg(listing.quantityKg)} />
        <Stat label={translate('marketplace.distance')} value={formatKm(mockDistanceKm(listing.originRegion))} />
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.priceLabel}>{translate('marketplace.price_hint')}</Text>
        <Text style={styles.priceValue}>{formatTzs(listing.priceHintTzs)}</Text>
      </View>
    </Card>
  )
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  glyphWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center'
  },
  glyph: { ...typography.bodyStrong, color: colors.earth },
  headerBody: { flex: 1 },
  title: { ...typography.heading, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  stat: { flex: 1 },
  statLabel: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase' },
  statValue: { ...typography.bodyStrong, color: colors.ink, marginTop: 2 },
  footerRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  priceLabel: { ...typography.caption, color: colors.inkMuted },
  priceValue: { ...typography.bodyStrong, color: colors.forest }
})
