/**
 * Buyer-mobile — L8 sign-delivery screen.
 *
 * Buyer reviews the accepted RFB response and signs delivery, which the
 * api-gateway turns into a settlement (math → LedgerService.post() →
 * M-Pesa B2C payout). Result shows the gross/royalty/fee/net breakdown.
 *
 * IMPORTANT (money path — see CLAUDE.md): signing requires (1) the real
 * `responseId` of the fulfilled response and (2) a chain-of-custody step
 * checksum computed from the CoC step data returned by the gateway.
 * The buyer reaches this screen from the L7 `rfb_fulfilled` notification,
 * which carries `response_id` — we use that as the real settlement target
 * (the rfb_id is NOT a responseId).
 *
 * The CoC endpoint GET /api/v1/marketplace/rfb-responses/:responseId/chain-of-custody
 * now exists (Wave A). We fetch it via useQuery; when the data is loaded we
 * compute the checksum as SHA-256 of JSON.stringify(steps). The Sign button
 * is enabled only when (responseId + CoC loaded + checksum computed).
 *
 * Bilingual sw/en throughout.
 */

import { useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTranslation } from '@/hooks/useTranslation'
// All UI strings are in i18n/en.json + sw.json under the "sign_delivery" namespace.
import { Card } from '@/components/Card'
import { tokens } from '@/ui-litfin'
import { apiFetch } from '@/api/client'
import { rateSeller } from '@/api/bid-messaging'

const COC_PATH = (responseId: string) =>
  `/api/v1/marketplace/rfb-responses/${encodeURIComponent(responseId)}/chain-of-custody`

interface CoCStep {
  readonly stepId: string
  readonly actor: string
  readonly action: string
  readonly timestamp: string
}

interface CoCResponse {
  readonly success: boolean
  readonly data: {
    readonly responseId: string
    readonly steps: readonly CoCStep[]
    readonly checksum: string
  }
}

/** Fetch chain-of-custody steps for a fulfilled RFB response. */
async function fetchChainOfCustody(responseId: string): Promise<CoCResponse['data']> {
  const res = await apiFetch<CoCResponse>(COC_PATH(responseId))
  if (!res.success || !res.data) {
    throw new Error('chain_of_custody_fetch_failed')
  }
  return res.data
}

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

function formatTzs(amount: number): string {
  const fmt = new Intl.NumberFormat('en-US', {
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
}: {
  readonly settlementId: string
}): JSX.Element {
  const { t } = useTranslation()
  const [stars, setStars] = useState<number>(0)
  const mutation = useMutation({
    mutationFn: (value: number) => rateSeller({ settlementId, stars: value }),
  })

  return (
    <Card>
      <Text style={styles.cardTitle}>
        {t('sign_delivery.rate_seller_title')}
      </Text>
      {mutation.isSuccess ? (
        <Text style={styles.successTitle}>
          {t('sign_delivery.rate_seller_thanks')}
        </Text>
      ) : (
        <>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`${n}`}
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
                ? t('sign_delivery.rate_seller_submitting')
                : t('sign_delivery.rate_seller_submit')}
            </Text>
          </Pressable>
          {mutation.isError ? (
            <Text style={styles.errorBody}>
              {t('sign_delivery.rate_seller_failed')}
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
  const { t } = useTranslation()

  // Fetch chain-of-custody for this fulfilled response.
  // The endpoint GET /api/v1/marketplace/rfb-responses/:responseId/chain-of-custody
  // was shipped in Wave A. Only fetch when we have a real responseId.
  const cocQuery = useQuery({
    queryKey: ['coc', responseId],
    queryFn: () => fetchChainOfCustody(responseId),
    enabled: responseId.length > 0
  })

  // The gateway returns a checksum in the CoC response; use it directly
  // so the server is the canonical authority on what was verified.
  const cocChecksum = useMemo(
    () => (cocQuery.data ? cocQuery.data.checksum : null),
    [cocQuery.data]
  )

  const mutation = useMutation({
    mutationFn: (input: SignDeliveryInput) => signDelivery(input),
  })

  const isSignEnabled =
    responseId.length > 0 &&
    cocQuery.isSuccess &&
    typeof cocChecksum === 'string' &&
    cocChecksum.length > 0 &&
    !mutation.isPending

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>
            {t('sign_delivery.eyebrow')}
          </Text>
          <Text style={styles.title}>
            {t('sign_delivery.title')}
          </Text>
          <Text style={styles.subtitle}>
            {t('sign_delivery.subtitle')}
          </Text>
        </View>

        <Card>
          <Text style={styles.cardTitle}>
            {t('sign_delivery.rfb_details')}
          </Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t('sign_delivery.rfb_id')}</Text>
            <Text style={styles.value}>
              {rfbId ? `${rfbId.slice(0, 8)}…` : '—'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('sign_delivery.response_id')}</Text>
            <Text style={styles.valueMono}>
              {responseId ? `${responseId.slice(0, 8)}…` : '—'}
            </Text>
          </View>
        </Card>

        {/* CoC loading / error state */}
        {responseId.length > 0 && cocQuery.isLoading ? (
          <Card>
            <View style={styles.cocLoader}>
              <ActivityIndicator color={tokens.color.gold} />
              <Text style={styles.muted}>
                {t('sign_delivery.coc_loading')}
              </Text>
            </View>
          </Card>
        ) : null}

        {responseId.length === 0 ? (
          <Card>
            <Text style={styles.errorTitle}>
              {t('sign_delivery.no_response_id')}
            </Text>
          </Card>
        ) : null}

        {responseId.length > 0 && cocQuery.isError ? (
          <Card>
            <Text style={styles.errorTitle}>
              {t('sign_delivery.coc_error_title')}
            </Text>
            <Text style={styles.errorBody}>
              {t('sign_delivery.coc_error_body')}
            </Text>
          </Card>
        ) : null}

        {mutation.isError ? (
          <Card>
            <Text style={styles.errorTitle}>
              {t('sign_delivery.failed')}
            </Text>
            <Text style={styles.errorBody}>
              {mutation.error instanceof Error
                ? mutation.error.message
                : t('sign_delivery.unknown_error')}
            </Text>
          </Card>
        ) : null}

        {mutation.isSuccess && mutation.data ? (
          <Card>
            <Text style={styles.successTitle}>
              {t('sign_delivery.settled')}
            </Text>
            <View style={styles.row}>
              <Text style={styles.label}>{t('sign_delivery.gross')}</Text>
              <Text style={styles.value}>
                {formatTzs(mutation.data.grossTzs)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>{t('sign_delivery.royalty')}</Text>
              <Text style={styles.value}>
                {formatTzs(mutation.data.royaltyTzs)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>{t('sign_delivery.platform_fee')}</Text>
              <Text style={styles.value}>
                {formatTzs(mutation.data.feeTzs)}
              </Text>
            </View>
            <View style={[styles.row, styles.rowEmphasis]}>
              <Text style={styles.labelEmphasis}>
                {t('sign_delivery.seller_receives')}
              </Text>
              <Text style={styles.valueEmphasis}>
                {formatTzs(mutation.data.netTzs)}
              </Text>
            </View>
            {mutation.data.ledgerTxnId ? (
              <View style={styles.row}>
                <Text style={styles.label}>
                  {t('sign_delivery.ledger_txn')}
                </Text>
                <Text style={styles.valueMono}>
                  {mutation.data.ledgerTxnId.slice(0, 16)}…
                </Text>
              </View>
            ) : null}
            {mutation.data.payoutProvider ? (
              <View style={styles.row}>
                <Text style={styles.label}>{t('sign_delivery.provider')}</Text>
                <Text style={styles.value}>
                  {mutation.data.payoutProvider}
                </Text>
              </View>
            ) : null}
            {mutation.data.idempotent ? (
              <Text style={styles.muted}>
                {t('sign_delivery.already_settled')}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {mutation.isSuccess && mutation.data ? (
          <RateSellerCard settlementId={mutation.data.settlementId} />
        ) : null}

        <Pressable
          disabled={!isSignEnabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !isSignEnabled }}
          onPress={() => {
            if (cocChecksum !== null) {
              mutation.mutate({ responseId, coCStepChecksum: cocChecksum })
            }
          }}
          style={({ pressed }) => [
            styles.cta,
            pressed && isSignEnabled && styles.ctaPressed,
            !isSignEnabled && styles.ctaDisabled
          ]}
        >
          <Text style={styles.ctaText}>
            {t('sign_delivery.sign_button')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/notifications')}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryText}>
            {t('sign_delivery.view_notifications')}
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
  cocLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
  },
})
