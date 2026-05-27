import { useMemo, useRef, useState } from 'react'
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { useToast } from '@/components/Toast'
import { formatTzs } from '@/components/formatters'
import { placeBid, type PaymentTerms } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import { BidRecommendationResultSchema, type BidRecommendation } from '../toolPayloads'

export interface BidRecommendationCardProps {
  readonly payload: unknown
  readonly translate: (key: string) => string
}

// `bids.recommend` tool. Renders an AI bid recommendation as a
// slide-to-confirm card (R4 §3 Swiggy pattern) — the buyer drags the
// thumb to the right to authorize. We never auto-submit; the slider's
// completion guarantees explicit consent before hitting the gateway.

const SLIDE_THRESHOLD = 0.85
const THUMB_WIDTH = 56

export function BidRecommendationCard({ payload, translate }: BidRecommendationCardProps) {
  const parsed = BidRecommendationResultSchema.safeParse(payload)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [trackWidth, setTrackWidth] = useState(0)
  const offset = useRef(new Animated.Value(0)).current
  const [confirmed, setConfirmed] = useState(false)

  const mutation = useMutation({
    mutationFn: async (rec: BidRecommendation) => {
      return placeBid({
        listingId: rec.listingId,
        offerTzsPerKg: rec.recommendedTzsPerKg,
        quantityKg: rec.quantityKg,
        paymentTerms: rec.paymentTerms as PaymentTerms,
        notes: rec.rationale,
        termsAccepted: true
      })
    },
    onSuccess: async () => {
      toast.show(translate('bids.bid_submitted'), 'success')
      await queryClient.invalidateQueries({ queryKey: queryKeys.bids() })
    },
    onError: () => {
      toast.show(translate('bids.bid_failed'), 'error')
      setConfirmed(false)
      Animated.spring(offset, { toValue: 0, useNativeDriver: false }).start()
    }
  })

  const maxTranslate = Math.max(trackWidth - THUMB_WIDTH, 0)

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !confirmed && !mutation.isPending,
        onMoveShouldSetPanResponder: () => !confirmed && !mutation.isPending,
        onPanResponderMove: (_, gesture: PanResponderGestureState) => {
          if (maxTranslate <= 0 || !parsed.success) return
          const next = Math.min(Math.max(gesture.dx, 0), maxTranslate)
          offset.setValue(next)
        },
        onPanResponderRelease: (_, gesture: PanResponderGestureState) => {
          if (maxTranslate <= 0 || !parsed.success) {
            return
          }
          const ratio = gesture.dx / maxTranslate
          if (ratio >= SLIDE_THRESHOLD) {
            Animated.spring(offset, { toValue: maxTranslate, useNativeDriver: false }).start()
            setConfirmed(true)
            mutation.mutate(parsed.data)
          } else {
            Animated.spring(offset, { toValue: 0, useNativeDriver: false }).start()
          }
        }
      }),
    [confirmed, mutation, maxTranslate, offset, parsed]
  )

  if (!parsed.success) {
    return null
  }

  const rec = parsed.data
  const total = rec.recommendedTzsPerKg * rec.quantityKg

  function handleLayout(event: LayoutChangeEvent): void {
    setTrackWidth(event.nativeEvent.layout.width)
  }

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {rec.listingTitle}
        </Text>
        <Pill label="AI" tone="gold" />
      </View>
      <View style={styles.rows}>
        <Row label={translate('bids.bid_price')} value={`${formatTzs(rec.recommendedTzsPerKg)} / kg`} />
        <Row label={translate('marketplace.quantity')} value={`${rec.quantityKg} kg`} />
        <Row label={translate('bids.payment_terms')} value={paymentTermLabel(rec.paymentTerms, translate)} />
        <Row label={translate('documents.total')} value={formatTzs(total)} strong />
      </View>
      {rec.rationale ? <Text style={styles.rationale}>{rec.rationale}</Text> : null}
      <View style={styles.track} onLayout={handleLayout}>
        <Text style={styles.trackLabel}>
          {confirmed ? translate('bids.bid_submitted') : translate('bids.submit_bid')}
        </Text>
        <Animated.View
          style={[styles.thumb, { transform: [{ translateX: offset }] }]}
          {...panResponder.panHandlers}
        >
          <Text style={styles.thumbGlyph}>{confirmed ? '✓' : '›'}</Text>
        </Animated.View>
      </View>
    </Card>
  )
}

function paymentTermLabel(term: BidRecommendation['paymentTerms'], translate: (k: string) => string): string {
  if (term === '30d') return translate('bids.payment_30')
  if (term === '60d') return translate('bids.payment_60')
  return translate('bids.payment_instant')
}

function Row({ label, value, strong }: { readonly label: string; readonly value: string; readonly strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={strong ? styles.rowValueStrong : styles.rowValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { ...typography.heading, color: colors.ink, flex: 1, paddingRight: spacing.md },
  rows: { gap: spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { ...typography.caption, color: colors.inkMuted },
  rowValue: { ...typography.body, color: colors.ink },
  rowValueStrong: { ...typography.bodyStrong, color: colors.forest },
  rationale: { ...typography.caption, color: colors.inkSoft, marginBottom: spacing.md },
  track: {
    height: 56,
    backgroundColor: colors.cream,
    borderRadius: radius.pill,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    overflow: 'hidden'
  },
  trackLabel: {
    ...typography.bodyStrong,
    color: colors.inkSoft,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_WIDTH,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center'
  },
  thumbGlyph: { ...typography.title, color: colors.bone }
})
