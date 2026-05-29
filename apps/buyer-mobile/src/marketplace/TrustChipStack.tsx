/**
 * TrustChipStack — Airbnb-style trust-above-the-fold chip row for
 * every parcel card and parcel detail screen.
 *
 * Closes G2 in `Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md` — wires the
 * trust signals researched in `Docs/RESEARCH/buyer-marketplace-sota.md`
 * §7 (gov-licensed, lab-assayed, borjie-vetted, chain-of-custody,
 * seller-history).
 *
 * Derivation logic lives in `./trustChips.ts` so it can be unit-
 * tested without pulling React Native into the JSDOM rig.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Listing } from '@/types/listing'
import { tokens } from '@/ui-litfin'
import { deriveTrustChips, type TrustChip } from './trustChips'

export type { TrustChip, TrustChipKind } from './trustChips'
export { deriveTrustChips } from './trustChips'

export interface TrustChipStackProps {
  readonly listing: Listing
  readonly translate: (key: string) => string
  readonly onChipPress?: (chip: TrustChip) => void
}

export function TrustChipStack({ listing, translate, onChipPress }: TrustChipStackProps) {
  const chips = deriveTrustChips({ listing, translate })
  if (chips.length === 0) {
    return null
  }
  return (
    <View style={styles.row} testID="trust-chip-stack" accessibilityRole="summary">
      {chips.map((chip) => (
        <Pressable
          key={chip.kind}
          onPress={() => onChipPress?.(chip)}
          style={[styles.chip, toneStyle(chip.tone)]}
          accessibilityLabel={chip.label}
          accessibilityRole="button"
        >
          <Text style={[styles.chipLabel, toneTextStyle(chip.tone)]}>{chip.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function toneStyle(tone: TrustChip['tone']) {
  switch (tone) {
    case 'verified':
      return { borderColor: tokens.color.borderGold, backgroundColor: 'rgba(255,200,87,0.08)' }
    case 'attention':
      return { borderColor: 'rgba(255,184,0,0.42)', backgroundColor: 'rgba(255,184,0,0.06)' }
    case 'neutral':
      return { borderColor: tokens.color.border, backgroundColor: 'transparent' }
  }
}

function toneTextStyle(tone: TrustChip['tone']) {
  switch (tone) {
    case 'verified':
      return { color: tokens.color.gold }
    case 'attention':
      return { color: tokens.color.warn }
    case 'neutral':
      return { color: tokens.color.textMuted }
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.xs,
    marginTop: tokens.space.sm
  },
  chip: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    borderRadius: tokens.radius.pill,
    borderWidth: 1
  },
  chipLabel: {
    ...tokens.type.micro,
    fontWeight: '600' as const
  }
})
