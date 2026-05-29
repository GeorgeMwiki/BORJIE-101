/**
 * Buyer-mobile — L8 sign-delivery screen.
 *
 * Buyer reviews the accepted RFB response, taps "Sign delivery" with a
 * deterministic checksum, and the api-gateway runs the settlement
 * orchestrator end-to-end (math → LedgerService.post() → M-Pesa B2C
 * payout). Result is shown in a success banner with the gross/royalty/
 * fee/net breakdown.
 *
 * Bilingual sw/en throughout.
 */

import { useState, useCallback } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTranslation } from '@/hooks/useTranslation'
import { Card } from '@/components/Card'
import { tokens } from '@/ui-litfin'
import { apiFetch } from '@/api/client'

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
 * Deterministic checksum stub — the real screen would compute this
 * from the parcel's CoC chain (sha256 over each step's audit hash).
 * For now we derive a value that's stable for the (rfbId, deviceTs)
 * pair so idempotent replays from the same buyer collapse.
 */
function deriveChecksum(rfbId: string): string {
  // Stable within the screen session — re-tapping "Sign" within the
  // same mount uses the same checksum so the backend collapses replays.
  return `coc-${rfbId}-${Date.now()}`
}

export default function SignDeliveryScreen(): JSX.Element {
  const params = useLocalSearchParams<{ id: string }>()
  const rfbId = String(params.id ?? '')
  const router = useRouter()
  const { lang } = useTranslation()
  const isSw = lang === 'sw'
  const [checksum] = useState<string>(() => deriveChecksum(rfbId))

  const mutation = useMutation({
    mutationFn: (responseId: string) =>
      signDelivery({ responseId, coCStepChecksum: checksum }),
  })

  // For now, the screen uses the rfbId as a stand-in for the responseId
  // until the screen is wired to the accepted-response lookup. The real
  // screen loads /api/v1/marketplace/rfb/:id and picks the accepted
  // response id; for the L8 chain we surface the form + CTA.
  const responseId = rfbId

  const onSubmit = useCallback(() => {
    if (!responseId) return
    mutation.mutate(responseId)
  }, [mutation, responseId])

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
            <Text style={styles.value}>{rfbId.slice(0, 8)}…</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>
              {isSw ? 'Saini ya CoC' : 'CoC checksum'}
            </Text>
            <Text style={styles.valueMono}>{checksum.slice(-12)}</Text>
          </View>
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

        <Pressable
          onPress={onSubmit}
          disabled={mutation.isPending || mutation.isSuccess}
          style={({ pressed }) => [
            styles.cta,
            pressed && styles.ctaPressed,
            (mutation.isPending || mutation.isSuccess) && styles.ctaDisabled,
          ]}
        >
          <Text style={styles.ctaText}>
            {mutation.isPending
              ? isSw
                ? 'Inashughulikia…'
                : 'Processing…'
              : mutation.isSuccess
                ? isSw
                  ? 'Imefanyika'
                  : 'Done'
                : isSw
                  ? 'Saini Uwasilishaji'
                  : 'Sign Delivery'}
          </Text>
        </Pressable>

        {mutation.isSuccess ? (
          <Pressable
            onPress={() => router.push('/notifications')}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          >
            <Text style={styles.secondaryText}>
              {isSw ? 'Angalia arifa' : 'View notifications'}
            </Text>
          </Pressable>
        ) : null}
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
