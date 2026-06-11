import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'
import type { MarketplaceSeller } from '@/types/listing'

export interface SellerBrowseBarProps {
  readonly sellers: readonly MarketplaceSeller[]
  readonly onSelect: (sellerTenantId: string) => void
  readonly translate: (key: string) => string
}

/**
 * "Browse by mine" rail — horizontal chips of the seller orgs that
 * currently have buyer-visible active listings. Tapping a mine deep-links
 * into its owner-scoped marketplace (`/marketplace/[sellerId]`). The
 * parent hides this rail entirely while loading / on error / when empty,
 * so it never fabricates sellers.
 */
export function SellerBrowseBar({ sellers, onSelect, translate }: SellerBrowseBarProps) {
  if (sellers.length === 0) {
    return null
  }
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{translate('marketplace.browse_by_mine')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {sellers.map((seller) => (
          <Pressable
            key={seller.sellerTenantId}
            onPress={() => onSelect(seller.sellerTenantId)}
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.chipName} numberOfLines={1}>
              {seller.sellerName && seller.sellerName.length > 0
                ? seller.sellerName
                : translate('marketplace.this_mine')}
            </Text>
            <Text style={styles.chipCount}>
              {seller.listingCount} {translate('marketplace.listings_count_unit')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: tokens.space.md },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: tokens.color.textMuted,
    textTransform: 'uppercase',
    marginBottom: tokens.space.sm
  },
  row: { gap: tokens.space.sm, paddingRight: tokens.space.md },
  chip: {
    backgroundColor: tokens.color.bgRaised,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.borderGold,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    minWidth: 120,
    maxWidth: 200
  },
  chipPressed: { opacity: 0.94, transform: [{ scale: 0.99 }] },
  chipName: { ...tokens.type.bodySmStrong, color: tokens.color.textPrimary },
  chipCount: { ...tokens.type.bodySm, color: tokens.color.gold, marginTop: 2 }
})
