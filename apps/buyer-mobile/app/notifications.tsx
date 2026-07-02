/**
 * Buyer-mobile — L7 notifications inbox.
 *
 * Lists `buyer_notifications` rows for the authenticated buyer. Tap on
 * a row marks it read and (where applicable) deep-links to the source
 * RFB. Pull-to-refresh re-fetches the first page.
 *
 * ── Single source of truth (SLICE TZ4) ─────────────────────────────
 * The PERSISTED `buyer_notifications` query is the ONLY inbox state.
 * The cockpit SSE pulse no longer maintains a parallel in-memory list
 * with its own read-state (which used to diverge from the server
 * record); instead `EventStreamMount` invalidates this query on every
 * pulse, so the live "new notification" affordance and the unread badge
 * are both derived from `read_at` on the authoritative rows.
 *
 * Bilingual sw/en throughout.
 */

import { useCallback, useMemo } from 'react'
import { useRouter } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { bcp47For } from '@/lib/locale'
import { tokens } from '@/ui-litfin'
import {
  listBuyerNotifications,
  markBuyerNotificationRead,
  type BuyerNotificationRow,
} from '@/api/notifications'
import { queryKeys } from '@/api/queryKeys'

/** Safely read a `bidId` string from a notification payload bag. */
function readPayloadBidId(payload: Record<string, unknown>): string | null {
  const value = payload.bidId
  return typeof value === 'string' && value.length > 0 ? value : null
}

export default function NotificationsScreen(): JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { lang, t } = useTranslation()
  const isSw = lang === 'sw'

  const query = useQuery({
    queryKey: queryKeys.buyerNotifications(false),
    queryFn: () => listBuyerNotifications({ limit: 50 }),
    staleTime: 15_000,
  })

  const invalidateInbox = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['buyer-notifications'] })
  }, [queryClient])

  const markRead = useMutation({
    mutationFn: (id: string) => markBuyerNotificationRead(id),
    onSuccess: invalidateInbox,
  })

  // Batch mark-all-read over the persisted rows — the ONE read-state.
  const markAllRead = useMutation({
    mutationFn: async (ids: ReadonlyArray<string>) => {
      await Promise.all(ids.map((id) => markBuyerNotificationRead(id)))
    },
    onSuccess: invalidateInbox,
  })

  const onTap = useCallback(
    (row: BuyerNotificationRow) => {
      if (!row.read_at) {
        markRead.mutate(row.id)
      }
      if (row.kind === 'rfb_fulfilled' && row.rfb_id) {
        // Carry the accepted/fulfilled response id through — it is the
        // real settlement target. Without it the sign-delivery screen
        // cannot resolve a responseId (the rfb_id is NOT a responseId).
        const query = row.response_id
          ? `?responseId=${encodeURIComponent(row.response_id)}`
          : ''
        router.push(`/rfb/${row.rfb_id}/sign-delivery${query}`)
        return
      }
      // COMPLETION-LAW: a `bid_accepted` notification carries the bid id in its
      // payload. Deep-link to the bid detail, where the buyer's mirror of the
      // now-binding offtake contract is surfaced.
      if (row.kind === 'bid_accepted') {
        const bidId = readPayloadBidId(row.payload)
        if (bidId) {
          router.push(`/bids/${bidId}`)
        }
      }
    },
    [markRead, router],
  )

  const notifications = query.data?.notifications ?? []
  const unreadIds = useMemo(
    () => notifications.filter((row) => !row.read_at).map((row) => row.id),
    [notifications],
  )
  const unreadCount = unreadIds.length

  const onMarkAllRead = useCallback(() => {
    if (unreadIds.length === 0 || markAllRead.isPending) return
    markAllRead.mutate(unreadIds)
  }, [markAllRead, unreadIds])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <View style={styles.padded}>
        <SectionHeader
          title={t('notifications.title')}
          subtitle={t('notifications.subtitle')}
        />
        {unreadCount > 0 ? (
          <UnreadBar
            unreadCount={unreadCount}
            t={t}
            disabled={markAllRead.isPending}
            onMarkAllRead={onMarkAllRead}
          />
        ) : null}
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => void query.refetch()}
            tintColor={tokens.color.gold}
          />
        }
        ListEmptyComponent={
          query.isPending ? (
            <Text style={styles.muted}>{t('notifications.loading')}</Text>
          ) : query.isError ? (
            <Text style={styles.error}>{t('notifications.error')}</Text>
          ) : (
            <EmptyState message={t('notifications.empty')} />
          )
        }
        renderItem={({ item }) => (
          <NotificationCard
            row={item}
            isSw={isSw}
            onPress={() => onTap(item)}
          />
        )}
      />
    </SafeAreaView>
  )
}

interface NotificationCardProps {
  readonly row: BuyerNotificationRow
  readonly isSw: boolean
  readonly onPress: () => void
}

function NotificationCard({
  row,
  isSw,
  onPress,
}: NotificationCardProps): JSX.Element {
  const title = isSw ? row.title_sw : row.title_en
  const body = isSw ? row.body_sw : row.body_en
  const isUnread = !row.read_at
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
        <View style={styles.cardHeader}>
          {isUnread ? <View style={styles.unreadDot} /> : null}
          <Text style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}>
            {title}
          </Text>
        </View>
        <Text style={styles.cardBody}>{body}</Text>
        <Text style={styles.cardTimestamp}>
          {new Date(row.created_at).toLocaleString(bcp47For(isSw ? 'sw' : 'en'))}
        </Text>
      </Card>
    </Pressable>
  )
}

interface UnreadBarProps {
  readonly unreadCount: number
  readonly t: (path: string, vars?: Readonly<Record<string, string | number>>) => string
  readonly disabled: boolean
  readonly onMarkAllRead: () => void
}

/**
 * Unread summary + mark-all affordance. Derived entirely from the
 * persisted rows' `read_at` — the single inbox read-state. The live
 * "new notification" affordance is the refetch-on-pulse driven by
 * EventStreamMount, so this bar updates itself when the server record
 * changes; there is no separate in-memory list.
 */
function UnreadBar({
  unreadCount,
  t,
  disabled,
  onMarkAllRead,
}: UnreadBarProps): JSX.Element {
  return (
    <View style={styles.unreadBar}>
      <Text style={styles.unreadBarTitle}>
        {t('notifications.unread_title', { count: unreadCount })}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onMarkAllRead}
      >
        <Text
          style={[styles.unreadBarLink, disabled && styles.unreadBarLinkDisabled]}
        >
          {t('notifications.mark_all_read')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: tokens.color.bgBase,
  },
  unreadBar: {
    marginTop: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.space.sm,
    backgroundColor: tokens.color.bgRaised,
    borderWidth: 1,
    borderColor: tokens.color.bgMuted,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  unreadBarTitle: {
    ...tokens.type.bodyStrong,
    color: tokens.color.gold,
  },
  unreadBarLink: {
    ...tokens.type.bodySm,
    color: tokens.color.gold,
  },
  unreadBarLinkDisabled: {
    color: tokens.color.textMuted,
  },
  padded: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.lg,
  },
  list: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.sm,
  },
  muted: {
    ...tokens.type.body,
    color: tokens.color.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: tokens.space.lg,
  },
  error: {
    ...tokens.type.body,
    color: tokens.color.danger,
    paddingHorizontal: tokens.space.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.color.gold,
  },
  cardTitle: {
    ...tokens.type.bodyStrong,
    color: tokens.color.textPrimary,
    flex: 1,
  },
  cardTitleUnread: {
    color: tokens.color.gold,
  },
  cardBody: {
    ...tokens.type.body,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs,
  },
  cardTimestamp: {
    ...tokens.type.bodySm,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs,
  },
})
