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
import { OfftakeContractCard } from '@/components/OfftakeContractCard'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { useOfftakeForBid } from '@/hooks/useOfftake'
import { useDebouncedSubmit } from '@/hooks/useDebouncedSubmit'
import { fetchBid, updateBidStatus } from '@/api/marketplace'
import { fetchThread, sendThreadMessage } from '@/api/bid-messaging'
import { queryKeys } from '@/api/queryKeys'
import { formatKg, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import type { BidStatus } from '@/types/listing'

const toneByStatus: Record<BidStatus, PillTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  countered: 'gold',
  withdrawn: 'neutral'
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

  // The bid-chat thread in the WS-2 surface is keyed by the RFB *response*
  // ID, not the marketplace bid ID. `threadResponseId` is set by mapGatewayBid
  // only when the gateway returns `rfbResponseId` for RFB-linked bids; it is
  // null for pure marketplace bids (which have no chat thread). We must NOT
  // fall back to `bidId` here: the bid-messaging surface rejects marketplace
  // bid IDs and 404s with THREAD_NOT_FOUND.
  const threadResponseId = query.data?.threadResponseId ?? null
  // `hasThread` gates the entire messaging section. When false the composer
  // and thread list are hidden — the buyer sees nothing rather than a broken UI.
  const hasThread = threadResponseId !== null

  // The bid-chat thread is served by the bid-messaging surface (one
  // thread keyed by the RFB response id), separate from the bid row itself.
  const threadQuery = useQuery({
    queryKey: queryKeys.thread(threadResponseId ?? ''),
    queryFn: () => fetchThread(threadResponseId as string),
    // Only fetch when we have the bid data AND the bid is linked to an RFB thread.
    enabled: query.isSuccess && hasThread
  })

  const messageMutation = useMutation({
    mutationFn: (input: { readonly body: string }) => {
      if (!threadResponseId) {
        return Promise.reject(new Error('no_thread'))
      }
      return sendThreadMessage({ responseId: threadResponseId, body: input.body })
    },
    onSuccess: async () => {
      setDraft('')
      if (threadResponseId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.thread(threadResponseId) })
      }
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

  // COMPLETION-LAW: an accepted bid crystallizes a binding offtake contract on
  // the seller side. Surface the buyer's mirror of that contract here — fetched
  // only once the bid is accepted (no contract exists before then).
  const bidAccepted = query.data?.status === 'accepted'
  const offtakeQuery = useOfftakeForBid(bidId, bidAccepted)

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
    messageMutation.mutate({ body: text })
  }
  // G4 — robustness 2026-05-29: belt-and-braces double-tap guard.
  // The mutation's `isPending` already gates the button while in
  // flight; the debounce window catches a sub-microsecond second tap
  // before the state flips on flaky mobile networks.
  const handleSend = useDebouncedSubmit(handleSendRaw)
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

      {bid.status === 'accepted' ? (
        <OfftakeContractCard
          contract={offtakeQuery.data}
          isLoading={offtakeQuery.isPending}
          isError={offtakeQuery.isError}
          error={offtakeQuery.error}
        />
      ) : null}

      {hasThread ? (
        <Card>
          <Text style={styles.cardTitle}>{t('bids.thread')}</Text>
          {(threadQuery.data?.messages ?? []).map((msg) => (
            <MessageBubble
              key={msg.id}
              from={msg.from}
              body={msg.body}
              authorLabel={msg.from === 'buyer' ? t('profile.title') : t('bids.seller_label')}
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
      ) : null}

      <View style={styles.actionStack}>
        {/*
          The 'Accept counter' CTA was removed: no seller counter-offer write
          path exists, so a `countered` bid never carries a counter price and
          the button would settle the offtake at the ORIGINAL bid price — a
          silent mispricing. Re-add it only once a seller counter route writes
          counter_price_tzs and the gateway surfaces it on the bid row, so the
          counter price can be shown next to the CTA and used at settlement.
        */}
        {bid.status === 'pending' ? (
          <PrimaryButton
            label={t('bids.withdraw_bid')}
            variant="ghost"
            onPress={handleWithdraw}
            disabled={statusMutation.isPending}
          />
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
