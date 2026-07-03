import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { formatKg, formatTzs } from '@/components/formatters'
import { mineralGlyph } from './options'
import { TrustChipStack } from './TrustChipStack'
import { resolveSellerName } from './sellerAttribution'
import { tokens } from '@/ui-litfin'
import type { Listing } from '@/types/listing'

export interface ListingCardProps {
  readonly listing: Listing
  readonly onPress: () => void
  readonly translate: (key: string) => string
}

export function ListingCard({ listing, onPress, translate }: ListingCardProps) {
  // The "from <mine>" label attributes a parcel to its owning mine —
  // gateway `sellerName` first, rich `seller.name` fallback.
  const sellerName = resolveSellerName(listing, translate('marketplace.this_mine'))
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
            {listing.originRegion} · {translate('marketplace.from_seller')} {sellerName}
          </Text>
        </View>
        <StatusPill status={listing.status} translate={translate} />
      </View>

      <View style={styles.statRow}>
        <Stat label={translate('marketplace.grade')} value={listing.grade} />
        <Stat label={translate('marketplace.quantity')} value={formatKg(listing.quantityKg)} />
      </View>

      <TrustChipStack listing={listing} translate={translate} />

      <View style={styles.footerRow}>
        <Text style={styles.priceLabel}>{translate('marketplace.price_hint')}</Text>
        <Text style={styles.priceValue}>{formatTzs(listing.priceHintTzs)}</Text>
      </View>
    </Card>
  )
}

// Reflects the REAL adapted listing status (mapped from the DB
// `active|paused|expired|sold|removed` → `open|reserved|closed`), so a
// closed/reserved parcel never masquerades as "Open". `neutral` tone keeps
// a closed listing visually distinct from a live one.
function StatusPill({
  status,
  translate
}: {
  readonly status: Listing['status']
  readonly translate: (key: string) => string
}) {
  switch (status) {
    case 'reserved':
      return <Pill label={translate('marketplace.status_reserved')} tone="warning" />
    case 'closed':
      return <Pill label={translate('marketplace.status_closed')} tone="neutral" />
    default:
      return <Pill label={translate('marketplace.status_open')} tone="success" />
  }
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
