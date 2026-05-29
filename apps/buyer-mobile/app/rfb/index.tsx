/**
 * R11 — buyer lists their RFBs.
 *
 * Mounted at /rfb. Shows status + pending response count for each
 * RFB the buyer has posted, most-recent first. Top CTA opens the
 * create screen.
 */
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { Pill, type PillTone } from '@/components/Pill'
import { EmptyState } from '@/components/EmptyState'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'

import { fetchMyRfbs, type RfbStatus } from '@/api/rfb'
import { queryKeys } from '@/api/queryKeys'

import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

const TONE_BY_STATUS: Record<RfbStatus, PillTone> = {
  open: 'success',
  filled: 'gold',
  expired: 'warning',
  cancelled: 'danger'
}

function formatPendingResponses(
  t: (key: string, vars?: Record<string, unknown>) => string,
  count: number
): string {
  if (count === 1) return t('rfb.response_count_one', { n: count })
  return t('rfb.response_count_other', { n: count })
}

export default function RfbIndex() {
  const router = useRouter()
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: queryKeys.rfbsMine(),
    queryFn: fetchMyRfbs
  })

  const header = (
    <View>
      <SectionHeader title={t('rfb.title')} subtitle={t('rfb.subtitle')} />
      <PrimaryButton
        label={t('rfb.create_cta')}
        onPress={() => router.push('/rfb/create')}
        testID="rfb-create-cta"
      />
    </View>
  )

  if (query.isLoading) {
    return (
      <Screen>
        {header}
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  const rfbs = query.data ?? []
  if (rfbs.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState message={t('rfb.list_empty')} />
      </Screen>
    )
  }

  return (
    <Screen refreshing={query.isFetching} onRefresh={() => query.refetch()}>
      {header}
      {rfbs.map((rfb) => (
        <Card key={rfb.id}>
          <View style={styles.row}>
            <Text style={styles.title}>
              {rfb.mineral_kind} · {rfb.tonnage_min} t
            </Text>
            <Pill
              label={t(`rfb.status_${rfb.status}`)}
              tone={TONE_BY_STATUS[rfb.status]}
            />
          </View>
          <Text style={styles.body}>
            {t('rfb.unit_price_label')}: {rfb.unit_price_tzs}
          </Text>
          <Text style={styles.body}>
            {t('rfb.delivery_by_label')}: {rfb.delivery_by}
          </Text>
          {rfb.status === 'open' ? (
            <Text style={styles.body}>
              {formatPendingResponses(t, rfb.pending_response_count)}
            </Text>
          ) : null}
        </Card>
      ))}
    </Screen>
  )
}

const styles = StyleSheet.create({
  loader: {
    paddingVertical: spacing.lg,
    alignItems: 'center'
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    ...typography.heading,
    color: colors.ink,
    flexShrink: 1,
    paddingRight: spacing.sm
  },
  body: {
    ...typography.body,
    color: colors.ink,
    marginTop: spacing.xs
  }
})
