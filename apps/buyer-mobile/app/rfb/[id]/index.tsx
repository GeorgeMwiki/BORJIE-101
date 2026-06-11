/**
 * RFB detail screen — /rfb/[id]
 *
 * Shows the buyer's own RFB details (mineral, tonnage, price, status,
 * expiry) and lists responses received from sellers. Each fulfilled
 * response has a "Sign delivery" CTA that navigates to sign-delivery.tsx
 * carrying the responseId as a param.
 *
 * The GET /api/v1/marketplace/rfb/:id/responses endpoint is planned for
 * Wave C. Until it is live the responses section shows the empty state
 * rather than an error (fetchRfbResponses swallows 404s).
 *
 * Bilingual sw/en via useTranslation. No console.*.
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTranslation } from '@/hooks/useTranslation'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill, type PillTone } from '@/components/Pill'
import { EmptyState } from '@/components/EmptyState'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useToast } from '@/components/Toast'

import {
  fetchMyRfbs,
  fetchRfbResponses,
  cancelRfb,
  type RfbStatus,
  type RfbResponse,
  type RfbSummary,
} from '@/api/rfb'
import { queryKeys } from '@/api/queryKeys'
import { formatTzs } from '@/components/formatters'

import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

const TONE_BY_STATUS: Record<RfbStatus, PillTone> = {
  open: 'success',
  filled: 'gold',
  expired: 'warning',
  cancelled: 'danger',
}

const RESPONSE_TONE_MAP: Record<RfbResponse['status'], PillTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  fulfilled: 'gold',
}

function RfbDetailCard({
  rfb,
  t,
}: {
  readonly rfb: RfbSummary
  readonly t: (key: string) => string
}): JSX.Element {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.cardTitle}>{rfb.mineral_kind}</Text>
        <Pill label={t(`rfb.status_${rfb.status}`)} tone={TONE_BY_STATUS[rfb.status]} />
      </View>
      <KeyValueRow
        label={t('rfb.detail_mineral')}
        value={rfb.mineral_kind}
      />
      <KeyValueRow
        label={t('rfb.detail_tonnage')}
        value={`${rfb.tonnage_min} t`}
      />
      <KeyValueRow
        label={t('rfb.detail_unit_price')}
        value={formatTzs(Number(rfb.unit_price_tzs))}
      />
      <KeyValueRow
        label={t('rfb.detail_delivery_by')}
        value={rfb.delivery_by}
      />
      <KeyValueRow
        label={t('rfb.detail_expires')}
        value={rfb.expires_at.slice(0, 10)}
      />
      <KeyValueRow
        label={t('rfb.detail_status')}
        value={t(`rfb.status_${rfb.status}`)}
      />
    </Card>
  )
}

function ResponseCard({
  response,
  t,
  onSignDelivery,
}: {
  readonly response: RfbResponse
  readonly t: (key: string) => string
  readonly onSignDelivery: (responseId: string) => void
}): JSX.Element {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.cardTitle}>
          {t('rfb.detail_response_seller')}: {response.seller_name}
        </Text>
        <Pill
          label={response.status}
          tone={RESPONSE_TONE_MAP[response.status]}
        />
      </View>
      {response.grade ? (
        <KeyValueRow label={t('rfb.detail_response_grade')} value={response.grade} />
      ) : null}
      <KeyValueRow
        label={t('rfb.detail_response_tonnage')}
        value={`${response.tonnage_kg} kg`}
      />
      <KeyValueRow
        label={t('rfb.detail_response_price')}
        value={formatTzs(Number(response.price_per_unit_tzs))}
      />
      {response.status === 'fulfilled' ? (
        <View style={styles.ctaRow}>
          <PrimaryButton
            label={t('rfb.detail_sign_delivery')}
            variant="gold"
            onPress={() => onSignDelivery(response.id)}
          />
        </View>
      ) : null}
    </Card>
  )
}

export default function RfbDetailScreen(): JSX.Element {
  const params = useLocalSearchParams<{ id: string }>()
  const rfbId = String(params.id ?? '')
  const router = useRouter()
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()

  // Reuse the /mine list and find this RFB by id rather than a per-id
  // endpoint (the gateway has no GET /rfb/:id yet).
  const rfbsQuery = useQuery({
    queryKey: queryKeys.rfbsMine(),
    queryFn: fetchMyRfbs,
  })

  const responsesQuery = useQuery({
    queryKey: queryKeys.rfbResponses(rfbId),
    queryFn: () => fetchRfbResponses(rfbId),
    enabled: rfbId.length > 0,
  })

  const cancelMutation = useMutation({
    mutationFn: () => cancelRfb(rfbId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.rfbsMine() })
      toast.show(t('rfb.cancel_success'), 'success')
      router.back()
    },
    onError: () => toast.show(t('rfb.cancel_failed'), 'error'),
  })

  function handleSignDelivery(responseId: string): void {
    router.push({
      pathname: '/rfb/[id]/sign-delivery',
      params: { id: rfbId, responseId },
    })
  }

  if (rfbsQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
          <Text style={styles.loadingText}>{t('rfb.detail_loading')}</Text>
        </View>
      </Screen>
    )
  }

  const rfb: RfbSummary | undefined = rfbsQuery.data?.find((r) => r.id === rfbId)

  if (rfbsQuery.isError || !rfb) {
    return (
      <Screen>
        <Card>
          <Text style={styles.errorText}>{t('rfb.detail_load_failed')}</Text>
          <View style={styles.ctaRow}>
            <PrimaryButton
              label={t('common.retry')}
              variant="ghost"
              onPress={() => void rfbsQuery.refetch()}
            />
          </View>
        </Card>
      </Screen>
    )
  }

  const responses = responsesQuery.data ?? []

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTitle}>{t('rfb.detail_title')}</Text>

        <RfbDetailCard rfb={rfb} t={t} />

        {rfb.status === 'open' ? (
          <View style={styles.ctaRow}>
            <PrimaryButton
              label={t('rfb.detail_cancel_cta')}
              variant="ghost"
              onPress={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{t('rfb.detail_responses_title')}</Text>

        {responses.length === 0 ? (
          <EmptyState message={t('rfb.detail_responses_empty')} />
        ) : (
          responses.map((response) => (
            <ResponseCard
              key={response.id}
              response={response}
              t={t}
              onSignDelivery={handleSignDelivery}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.forest,
  },
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  screenTitle: {
    ...typography.heading,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.ink,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  ctaRow: {
    marginTop: spacing.md,
  },
  loader: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.inkMuted,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
  },
})
