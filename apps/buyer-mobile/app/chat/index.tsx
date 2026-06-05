import { useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { MessageBubble } from '@/components/MessageBubble'
import { PrimaryButton } from '@/components/PrimaryButton'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { fetchBids, fetchBid, sendBidMessage } from '@/api/marketplace'
import { fetchThread, sendThreadMessage } from '@/api/bid-messaging'
import { queryKeys } from '@/api/queryKeys'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

// The chat screen handles two thread sources:
//   - WS-2 RFB-response thread (params.responseId) — the canonical
//     buyer ↔ seller chat backed by `bid_messages` (one thread per RFB
//     response). Preferred when a responseId is supplied (e.g. deep link
//     from an accepted RFB response).
//   - Legacy bid thread (params.bidId) — falls back to the first active
//     bid so the screen stays reachable from the bottom nav / deep link.
export default function ChatIndex() {
  const params = useLocalSearchParams<{ bidId?: string; responseId?: string }>()
  const responseId = params.responseId ? String(params.responseId) : null

  if (responseId) {
    return <ResponseThread responseId={responseId} />
  }
  return <BidThread bidId={params.bidId ? String(params.bidId) : undefined} />
}

// ───────────────────────── RFB-response thread ──────────────────────

function ResponseThread({ responseId }: { readonly responseId: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')

  const threadQuery = useQuery({
    queryKey: queryKeys.thread(responseId),
    queryFn: () => fetchThread(responseId),
  })

  const sendMutation = useMutation({
    mutationFn: sendThreadMessage,
    onSuccess: async () => {
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: queryKeys.thread(responseId) })
    },
    onError: () => toast.show(t('bids.bid_failed'), 'error'),
  })

  if (threadQuery.isLoading) {
    return (
      <Screen>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('chat.loading')}
          style={styles.loader}
        >
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  if (threadQuery.isError) {
    return (
      <Screen>
        <SectionHeader title={t('chat.title')} />
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>{t('chat.load_failed')}</Text>
          <PrimaryButton
            label={t('common.retry')}
            variant="ghost"
            onPress={() => void threadQuery.refetch()}
          />
        </View>
      </Screen>
    )
  }

  const thread = threadQuery.data
  const messages = thread?.messages ?? []

  function handleSend(): void {
    const text = draft.trim()
    if (!text) {
      return
    }
    sendMutation.mutate({ responseId, body: text })
  }

  return (
    <Screen scroll={false}>
      <SectionHeader title={t('chat.title')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.list}>
          {messages.length === 0 ? (
            <Text style={styles.empty}>{t('chat.empty')}</Text>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                from={msg.from}
                body={msg.body}
                authorLabel={msg.from === 'buyer' ? t('profile.title') : 'Seller'}
              />
            ))
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            multiline
          />
          <PrimaryButton
            label={t('chat.send')}
            onPress={handleSend}
            disabled={sendMutation.isPending || draft.trim().length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

// ───────────────────────── legacy bid thread ────────────────────────

function BidThread({ bidId }: { readonly bidId?: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')

  const bidsQuery = useQuery({ queryKey: queryKeys.bids(), queryFn: fetchBids, enabled: !bidId })
  const activeBidId = useMemo<string | null>(() => {
    if (bidId) {
      return bidId
    }
    const first = bidsQuery.data?.find((b) => b.status === 'pending' || b.status === 'countered')
    return first?.id ?? bidsQuery.data?.[0]?.id ?? null
  }, [bidId, bidsQuery.data])

  const bidQuery = useQuery({
    queryKey: activeBidId ? queryKeys.bid(activeBidId) : ['bid', 'none'],
    queryFn: () => (activeBidId ? fetchBid(activeBidId) : Promise.resolve(undefined)),
    enabled: Boolean(activeBidId)
  })

  const sendMutation = useMutation({
    mutationFn: sendBidMessage,
    onSuccess: async () => {
      setDraft('')
      if (activeBidId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.bid(activeBidId) })
      }
    },
    onError: () => toast.show(t('bids.bid_failed'), 'error')
  })

  if (bidsQuery.isLoading || bidQuery.isLoading) {
    return (
      <Screen>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('chat.loading')}
          style={styles.loader}
        >
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  if (bidsQuery.isError || bidQuery.isError) {
    return (
      <Screen>
        <SectionHeader title={t('chat.title')} />
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>{t('chat.load_failed')}</Text>
          <PrimaryButton
            label={t('common.retry')}
            variant="ghost"
            onPress={() => {
              void bidsQuery.refetch()
              void bidQuery.refetch()
            }}
          />
        </View>
      </Screen>
    )
  }

  if (!activeBidId || !bidQuery.data) {
    return (
      <Screen>
        <SectionHeader title={t('chat.title')} />
        <EmptyState message={t('chat.empty')} />
      </Screen>
    )
  }

  const bid = bidQuery.data

  function handleSend(): void {
    const text = draft.trim()
    if (!text || !activeBidId) {
      return
    }
    sendMutation.mutate({ bidId: activeBidId, body: text })
  }

  return (
    <Screen scroll={false}>
      <SectionHeader title={t('chat.title')} subtitle={bid.listingTitle} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.list}>
          {bid.thread.length === 0 ? (
            <Text style={styles.empty}>{t('chat.empty')}</Text>
          ) : (
            bid.thread.map((msg) => (
              <MessageBubble
                key={msg.id}
                from={msg.from}
                body={msg.body}
                authorLabel={msg.from === 'buyer' ? t('profile.title') : 'Seller'}
              />
            ))
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            multiline
          />
          <PrimaryButton
            label={t('chat.send')}
            onPress={handleSend}
            disabled={sendMutation.isPending || draft.trim().length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: spacing.lg },
  composer: { paddingTop: spacing.sm, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    minHeight: 56,
    textAlignVertical: 'top',
    ...typography.body
  },
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' },
  empty: { ...typography.body, color: colors.inkMuted, textAlign: 'center', paddingVertical: spacing.xl },
  errorBox: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.md },
  errorTitle: { ...typography.heading, color: colors.ink, textAlign: 'center' }
})
