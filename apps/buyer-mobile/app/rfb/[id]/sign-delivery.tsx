/**
 * Buyer-mobile — L8 sign-delivery screen.
 *
 * Buyer reviews the accepted RFB response and signs delivery, which the
 * api-gateway turns into a settlement (math → LedgerService.post() →
 * M-Pesa B2C payout). Result shows the gross/royalty/fee/net breakdown.
 *
 * IMPORTANT (money path — see CLAUDE.md): signing requires (1) the real
 * `responseId` of the fulfilled response and (2) a chain-of-custody step
 * checksum. The buyer reaches this screen from the L7 `rfb_fulfilled`
 * notification, which carries `response_id` — we use that as the real
 * settlement target (the rfb_id is NOT a responseId).
 *
 * The gateway exposes no buyer-facing endpoint that returns the accepted
 * response's chain-of-custody steps, so we CANNOT compute a genuine CoC
 * step checksum on-device. Rather than submit a fabricated checksum
 * (which would post a real ledger journal against unverifiable custody),
 * we render an honest "cannot sign — missing chain-of-custody" state and
 * block submission until that endpoint lands. No fake success on money.
 *
 * Bilingual sw/en throughout.
 */

import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTranslation } from '@/hooks/useTranslation'
import { Card } from '@/components/Card'
import { tokens } from '@/ui-litfin'
import { apiFetch } from '@/api/client'
import { rateSeller } from '@/api/bid-messaging'

// The gateway endpoint that would return the accepted response + its
// chain-of-custody steps (so the buyer can compute the CoC step checksum)
// does not exist yet. Tracked here for the marketplace gateway wave.
const MISSING_COC_ENDPOINT =
  'GET /api/v1/marketplace/rfb-responses/:responseId/chain-of-custody'

interface SignDeliveryResponse {
  readonly success: boolean
  readonly data?: {
    readonly settlementId: string
    readonly status: string
    readonly grossTzs: number
    readonly royaltyTzs: number
    readonly feeTzs: number
    readonly netTzs: number
    readonly ledgerTxnId: string | null
    readonly payoutProvider: string | null
    readonly idempotent: boolean
  }
  readonly error?: {
    readonly code?: string
    readonly message?: string | { sw?: string; en?: string }
  }
}

interface SignDeliveryInput {
  readonly responseId: string
  readonly coCStepChecksum: string
}

async function signDelivery(
  input: SignDeliveryInput,
): Promise<NonNullable<SignDeliveryResponse['data']>> {
  const res = await apiFetch<SignDeliveryResponse>(
    `/api/v1/marketplace/rfb-responses/${encodeURIComponent(input.responseId)}/sign-delivery`,
    {
      method: 'POST',
      body: { coCStepChecksum: input.coCStepChecksum },
    },
  )
  if (!res.success || !res.data) {
    throw new Error('Sign delivery failed')
  }
  return res.data
}

function formatTzs(amount: number, isSw: boolean): string {
  const fmt = new Intl.NumberFormat(isSw ? 'sw-TZ' : 'en-US', {
    maximumFractionDigits: 0,
  })
  return `${fmt.format(amount)} TZS`
}

/**
 * Post-settlement seller rating. Appears once a settlement exists; the
 * buyer picks 1–5 stars and submits to
 * POST /api/v1/mining/bid-messaging/settlements/:settlementId/rate.
 * One rating per settlement (idempotent server-side).
 */
function RateSellerCard({
  settlementId,
  isSw,
}: {
  readonly settlementId: string
  readonly isSw: boolean
}): JSX.Element {
  const [stars, setStars] = useState<number>(0)
  const mutation = useMutation({
    mutationFn: (value: number) => rateSeller({ settlementId, stars: value }),
  })

  return (
    <Card>
      <Text style={styles.cardTitle}>
        {isSw ? 'Mkadirie muuzaji' : 'Rate the seller'}
      </Text>
      {mutation.isSuccess ? (
        <Text style={styles.successTitle}>
          {isSw ? 'Asante kwa ukadiriaji wako' : 'Thanks for your rating'}
        </Text>
      ) : (
        <>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`${n} ${isSw ? 'nyota' : 'stars'}`}
                onPress={() => setStars(n)}
                disabled={mutation.isPending}
                style={styles.star}
              >
                <Text style={[styles.starGlyph, n <= stars && styles.starGlyphOn]}>
                  ★
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => stars > 0 && mutation.mutate(stars)}
            disabled={stars === 0 || mutation.isPending}
            style={({ pressed }) => [
              styles.cta,
              pressed && styles.ctaPressed,
              (stars === 0 || mutation.isPending) && styles.ctaDisabled,
            ]}
          >
            <Text style={styles.ctaText}>
              {mutation.isPending
                ? isSw
                  ? 'Inatuma…'
                  : 'Submitting…'
                : isSw
                  ? 'Wasilisha ukadiriaji'
                  : 'Submit rating'}
            </Text>
          </Pressable>
          {mutation.isError ? (
            <Text style={styles.errorBody}>
              {isSw ? 'Imeshindwa kutuma ukadiriaji' : 'Failed to submit rating'}
            </Text>
          ) : null}
        </>
      )}
    </Card>
  )
}

export default function SignDeliveryScreen(): JSX.Element {
  const params = useLocalSearchParams<{ id: string; responseId?: string }>()
  const rfbId = String(params.id ?? '')
  // The real settlement target — carried from the L7 rfb_fulfilled
  // notification's `response_id`. Empty when the screen was opened without
  // it (e.g. a stale deep link).
  const responseId = params.responseId ? String(params.responseId) : ''
  const router = useRouter()
  const { lang } = useTranslation()
  const isSw = lang === 'sw'

  const mutation = useMutation({
    mutationFn: (input: SignDeliveryInput) => signDelivery(input),
  })

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>
            {isSw ? 'Saini ya Uwasilishaji' : 'Sign Delivery'}
          </Text>
          <Text style={styles.title}>
            {isSw
              ? 'Thibitisha kupokea madini yako'
              : 'Confirm receipt of your minerals'}
          </Text>
          <Text style={styles.subtitle}>
            {isSw
              ? 'Kusaini kutaanzisha malipo kwa muuzaji moja kwa moja kupitia M-Pesa.'
              : 'Signing initiates payment to the seller via M-Pesa instantly.'}
          </Text>
        </View>

        <Card>
          <Text style={styles.cardTitle}>
            {isSw ? 'Maelezo ya RFB' : 'RFB details'}
          </Text>
          <View style={styles.row}>
            <Text style={styles.label}>{isSw ? 'RFB ID' : 'RFB id'}</Text>
            <Text style={styles.value}>
              {rfbId ? `${rfbId.slice(0, 8)}…` : '—'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{isSw ? 'Jibu (Response)' : 'Response id'}</Text>
            <Text style={styles.valueMono}>
              {responseId ? `${responseId.slice(0, 8)}…` : '—'}
            </Text>
          </View>
        </Card>

        {/*
          Money-path guard: we will not submit a fabricated CoC checksum.
          Until the gateway exposes the accepted response's chain-of-custody
          steps, signing is blocked with an honest explanation.
        */}
        <Card>
          <Text style={styles.errorTitle}>
            {isSw ? 'Huwezi kusaini bado' : 'Cannot sign yet'}
          </Text>
          <Text style={styles.errorBody}>
            {responseId
              ? isSw
                ? 'Hatuwezi kuthibitisha mnyororo wa ulinzi (chain-of-custody) wa jibu hili kwa sasa, kwa hivyo hatutatuma malipo kwa saini isiyothibitishwa.'
                : 'We cannot verify this response’s chain-of-custody right now, so we will not initiate payment with an unverified signature.'
              : isSw
                ? 'Hakuna kitambulisho cha jibu (response id). Fungua tena kutoka kwa arifa ya “RFB imekamilika”.'
                : 'No response id was provided. Re-open from the “RFB fulfilled” notification.'}
          </Text>
          <Text style={styles.muted}>
            {isSw ? 'Inasubiri endpoint: ' : 'Awaiting endpoint: '}
            {MISSING_COC_ENDPOINT}
          </Text>
        </Card>

        {mutation.isError ? (
          <Card>
            <Text style={styles.errorTitle}>
              {isSw ? 'Imeshindwa' : 'Failed'}
            </Text>
            <Text style={styles.errorBody}>
              {mutation.error instanceof Error
                ? mutation.error.message
                : isSw
                  ? 'Hitilafu isiyojulikana'
                  : 'Unknown error'}
            </Text>
          </Card>
        ) : null}

        {mutation.isSuccess && mutation.data ? (
          <Card>
            <Text style={styles.successTitle}>
              {isSw ? 'Imekamilika' : 'Settled'}
            </Text>
            <View style={styles.row}>
              <Text style={styles.label}>{isSw ? 'Jumla' : 'Gross'}</Text>
              <Text style={styles.value}>
                {formatTzs(mutation.data.grossTzs, isSw)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>{isSw ? 'Mrabaha' : 'Royalty'}</Text>
              <Text style={styles.value}>
                {formatTzs(mutation.data.royaltyTzs, isSw)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>{isSw ? 'Ada' : 'Platform fee'}</Text>
              <Text style={styles.value}>
                {formatTzs(mutation.data.feeTzs, isSw)}
              </Text>
            </View>
            <View style={[styles.row, styles.rowEmphasis]}>
              <Text style={styles.labelEmphasis}>
                {isSw ? 'Muuzaji atalipwa' : 'Seller receives'}
              </Text>
              <Text style={styles.valueEmphasis}>
                {formatTzs(mutation.data.netTzs, isSw)}
              </Text>
            </View>
            {mutation.data.ledgerTxnId ? (
              <View style={styles.row}>
                <Text style={styles.label}>
                  {isSw ? 'Jarida' : 'Ledger txn'}
                </Text>
                <Text style={styles.valueMono}>
                  {mutation.data.ledgerTxnId.slice(0, 16)}…
                </Text>
              </View>
            ) : null}
            {mutation.data.payoutProvider ? (
              <View style={styles.row}>
                <Text style={styles.label}>{isSw ? 'Njia' : 'Provider'}</Text>
                <Text style={styles.value}>
                  {mutation.data.payoutProvider}
                </Text>
              </View>
            ) : null}
            {mutation.data.idempotent ? (
              <Text style={styles.muted}>
                {isSw
                  ? 'Imekamilika tayari (idempotent)'
                  : 'Already settled (idempotent)'}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {mutation.isSuccess && mutation.data ? (
          <RateSellerCard settlementId={mutation.data.settlementId} isSw={isSw} />
        ) : null}

        {/* Signing is disabled until the CoC checksum can be computed for real. */}
        <Pressable
          disabled
          accessibilityState={{ disabled: true }}
          style={[styles.cta, styles.ctaDisabled]}
        >
          <Text style={styles.ctaText}>
            {isSw ? 'Saini Uwasilishaji' : 'Sign Delivery'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/notifications')}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryText}>
            {isSw ? 'Angalia arifa' : 'View notifications'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.bgBase },
  scroll: { padding: tokens.space.lg, gap: tokens.space.md },
  header: { marginBottom: tokens.space.md },
  eyebrow: {
    ...tokens.type.bodySm,
    color: tokens.color.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    ...tokens.type.h2,
    color: tokens.color.textPrimary,
    marginTop: tokens.space.xs,
  },
  subtitle: {
    ...tokens.type.body,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs,
  },
  cardTitle: {
    ...tokens.type.bodyStrong,
    color: tokens.color.textPrimary,
    marginBottom: tokens.space.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: tokens.space.xs,
  },
  rowEmphasis: {
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
    marginTop: tokens.space.sm,
    paddingTop: tokens.space.sm,
  },
  label: { ...tokens.type.body, color: tokens.color.textMuted },
  labelEmphasis: {
    ...tokens.type.bodyStrong,
    color: tokens.color.textPrimary,
  },
  value: { ...tokens.type.body, color: tokens.color.textPrimary },
  valueEmphasis: {
    ...tokens.type.bodyStrong,
    color: tokens.color.gold,
  },
  valueMono: {
    ...tokens.type.bodySm,
    color: tokens.color.textPrimary,
    fontFamily: 'Courier',
  },
  muted: {
    ...tokens.type.bodySm,
    color: tokens.color.textMuted,
    marginTop: tokens.space.sm,
    fontStyle: 'italic',
  },
  successTitle: {
    ...tokens.type.bodyStrong,
    color: tokens.color.gold,
    marginBottom: tokens.space.sm,
  },
  errorTitle: {
    ...tokens.type.bodyStrong,
    color: tokens.color.danger,
    marginBottom: tokens.space.sm,
  },
  errorBody: { ...tokens.type.body, color: tokens.color.danger },
  starsRow: {
    flexDirection: 'row',
    gap: tokens.space.xs,
    marginBottom: tokens.space.sm,
  },
  star: { padding: tokens.space.xs },
  starGlyph: { fontSize: 28, color: tokens.color.border },
  starGlyphOn: { color: tokens.color.gold },
  cta: {
    backgroundColor: tokens.color.gold,
    borderRadius: tokens.radius.xl,
    padding: tokens.space.lg,
    alignItems: 'center',
    marginTop: tokens.space.md,
  },
  ctaPressed: { opacity: 0.9 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: {
    ...tokens.type.bodyStrong,
    color: tokens.color.bgBase,
  },
  secondary: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.xl,
    padding: tokens.space.md,
    alignItems: 'center',
  },
  secondaryPressed: { opacity: 0.8 },
  secondaryText: { ...tokens.type.body, color: tokens.color.textPrimary },
})
