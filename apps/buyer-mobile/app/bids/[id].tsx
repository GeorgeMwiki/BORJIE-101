import { useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill, type PillTone } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { EmptyState } from '@/components/EmptyState'
import { MessageBubble } from '@/components/MessageBubble'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { useDebouncedSubmit } from '@/hooks/useDebouncedSubmit'
import { fetchBid, sendBidMessage, updateBidStatus } from '@/api/marketplace'
import { queryKeys } from '@/api/queryKeys'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import type { BidStatus } from '@/types/listing'

const toneByStatus: Record<BidStatus, PillTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  countered: 'gold'
}

export default function BidDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const bidId = String(id)
  const [draft, setDraft] = useState('')

  const query = useQuery({
    queryKey: queryKeys.bid(bidId),
    queryFn: () => fetchBid(bidId)
  })

  const messageMutation = useMutation({
    mutationFn: sendBidMessage,
    onSuccess: async () => {
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: queryKeys.bid(bidId) })
    },
    onError: () => toast.show(t('bids.bid_failed'), 'error')
  })

  const statusMutation = useMutation({
    mutationFn: updateBidStatus,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bid(bidId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.bids() })
    },
    onError: () => toast.show(t('bids.bid_failed'), 'error')
  })

  if (query.isLoading) {
    return (
      <Screen>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('bids.loading')}
          style={styles.loader}
        >
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  if (query.isError && !query.data) {
    return (
      <Screen>
        <Card>
          <Text style={styles.cardTitle}>{t('bids.load_failed')}</Text>
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

  const bid = query.data
  if (!bid) {
    return (
      <Screen>
        <EmptyState message={t('bids.empty')} />
      </Screen>
    )
  }

  function handleSendRaw(): void {
    const text = draft.trim()
    if (!text) {
      return
    }
    messageMutation.mutate({ bidId, body: text })
  }
  // G4 — robustness 2026-05-29: belt-and-braces double-tap guard.
  // The mutation's `isPending` already gates the button while in
  // flight; the debounce window catches a sub-microsecond second tap
  // before the state flips on flaky mobile networks.
  const handleSend = useDebouncedSubmit(handleSendRaw)
  const handleAccept = useDebouncedSubmit(() =>
    statusMutation.mutate({ bidId, action: 'accept' })
  )
  const handleWithdraw = useDebouncedSubmit(() =>
    statusMutation.mutate({ bidId, action: 'withdraw' })
  )

  return (
    <Screen>
      <SectionHeader title={bid.listingTitle} subtitle={t('bids.subtitle')} />

      <Card>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>{t('bids.your_offer')}</Text>
          <Pill label={t(`bids.status.${bid.status}`)} tone={toneByStatus[bid.status]} />
        </View>
        <KeyValueRow label={t('bids.your_offer')} value={`${formatTzs(bid.offerTzsPerKg)} / ${t('common.kg')}`} />
        <KeyValueRow label={t('marketplace.quantity')} value={formatKg(bid.quantityKg)} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('bids.thread')}</Text>
        {bid.thread.map((msg) => (
          <MessageBubble
            key={msg.id}
            from={msg.from}
            body={msg.body}
            authorLabel={msg.from === 'buyer' ? t('profile.title') : 'Seller'}
          />
        ))}
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('bids.message_placeholder')}
            placeholderTextColor={colors.inkMuted}
            multiline
            style={styles.input}
          />
          <PrimaryButton
            label={t('bids.send_message')}
            onPress={handleSend}
            disabled={messageMutation.isPending || draft.trim().length === 0}
          />
        </View>
      </Card>

      <View style={styles.actionStack}>
        {bid.status === 'countered' ? (
          <PrimaryButton
            label={t('bids.accept_counter')}
            variant="gold"
            onPress={handleAccept}
            disabled={statusMutation.isPending}
          />
        ) : null}
        {bid.status === 'pending' || bid.status === 'countered' ? (
          <View style={{ marginTop: spacing.sm }}>
            <PrimaryButton
              label={t('bids.withdraw_bid')}
              variant="ghost"
              onPress={handleWithdraw}
              disabled={statusMutation.isPending}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.sm },
  composer: { marginTop: spacing.md, gap: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    minHeight: 80,
    textAlignVertical: 'top',
    ...typography.body
  },
  actionStack: { marginTop: spacing.lg },
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' }
})
