import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { formatKg, formatTzs } from '@/components/formatters'
import { mockDistanceKm, formatKm } from './distance'
import { mineralGlyph } from './options'
import { TrustChipStack } from './TrustChipStack'
import { tokens } from '@/ui-litfin'
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

      <TrustChipStack listing={listing} translate={translate} />

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
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space.md },
  glyphWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 200, 87, 0.14)',
    borderWidth: 1,
    borderColor: tokens.color.borderGold,
    alignItems: 'center',
    justifyContent: 'center'
  },
  glyph: { fontSize: 18, fontWeight: '700', color: tokens.color.gold },
  headerBody: { flex: 1 },
  title: { ...tokens.type.h3, color: tokens.color.textPrimary },
  meta: { ...tokens.type.bodySm, color: tokens.color.textMuted, marginTop: 2 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: tokens.space.md },
  stat: { flex: 1 },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: tokens.color.textMuted,
    textTransform: 'uppercase'
  },
  statValue: { ...tokens.type.bodyStrong, color: tokens.color.textPrimary, marginTop: 4 },
  footerRow: {
    marginTop: tokens.space.md,
    paddingTop: tokens.space.md,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  priceLabel: { ...tokens.type.bodySm, color: tokens.color.textMuted },
  priceValue: { ...tokens.type.bodyStrong, color: tokens.color.gold }
})
