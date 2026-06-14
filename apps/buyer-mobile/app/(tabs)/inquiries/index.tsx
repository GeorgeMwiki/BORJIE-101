import { useQuery } from '@tanstack/react-query'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { EmptyState } from '@/components/EmptyState'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { fetchBuyerInquiries } from '@/api/inquiries'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

/**
 * KI-007 — the buyer's "Ask the seller" inquiries list. Consumes
 * GET /api/v1/buyer/inquiries (ReBAC: own-originated only). The buyer sees
 * the seller's response only once it is delivered (`answered`).
 */
export default function InquiriesIndex() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['buyer-inquiries'],
    queryFn: fetchBuyerInquiries
  })

  if (query.isLoading) {
    return (
      <Screen>
        <SectionHeader title={t('inquiry.list_title')} subtitle={t('inquiry.list_subtitle')} />
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  if (query.isError && !query.data) {
    return (
      <Screen>
        <SectionHeader title={t('inquiry.list_title')} subtitle={t('inquiry.list_subtitle')} />
        <Card>
          <Text style={styles.failed}>{t('inquiry.list_failed')}</Text>
          <View style={{ marginTop: spacing.sm }}>
            <PrimaryButton
              label={t('common.retry')}
              variant="ghost"
              onPress={() => void query.refetch()}
            />
          </View>
        </Card>
      </Screen>
    )
  }

  const inquiries = query.data ?? []
  if (inquiries.length === 0) {
    return (
      <Screen>
        <SectionHeader title={t('inquiry.list_title')} subtitle={t('inquiry.list_subtitle')} />
        <EmptyState message={t('inquiry.list_empty')} />
      </Screen>
    )
  }

  return (
    <Screen>
      <SectionHeader title={t('inquiry.list_title')} subtitle={t('inquiry.list_subtitle')} />
      {inquiries.map((inq) => (
        <Card key={inq.id}>
          <View style={styles.row}>
            <Text style={styles.title}>
              {inq.listingTitle ?? t('inquiry.untitled_listing')}
            </Text>
            <Pill
              label={inq.answered ? t('inquiry.answered') : t('inquiry.awaiting')}
              tone={inq.answered ? 'success' : 'warning'}
            />
          </View>
          {inq.message ? <Text style={styles.message}>{inq.message}</Text> : null}
          {inq.answered && inq.response ? (
            <View style={styles.responseBox}>
              <Text style={styles.responseLabel}>{t('inquiry.seller_reply')}</Text>
              <Text style={styles.responseBody}>{inq.response}</Text>
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.heading, color: colors.ink, flexShrink: 1, paddingRight: spacing.sm },
  message: { ...typography.body, color: colors.inkSoft, marginTop: spacing.sm },
  responseBox: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopColor: colors.line,
    borderTopWidth: 1
  },
  responseLabel: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase' },
  responseBody: { ...typography.body, color: colors.ink, marginTop: spacing.xs },
  failed: { ...typography.bodyStrong, color: colors.ink },
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' }
})
