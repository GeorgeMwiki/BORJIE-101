/**
 * Buyer-mobile — L7 notifications inbox.
 *
 * Lists `buyer_notifications` rows for the authenticated buyer. Tap on
 * a row marks it read and (where applicable) deep-links to the source
 * RFB. Pull-to-refresh re-fetches the first page.
 *
 * Bilingual sw/en throughout.
 */

import { useCallback } from 'react'
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
import { tokens } from '@/ui-litfin'
import {
  listBuyerNotifications,
  markBuyerNotificationRead,
  type BuyerNotificationRow,
} from '@/api/notifications'
import { queryKeys } from '@/api/queryKeys'

export default function NotificationsScreen(): JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { lang } = useTranslation()
  const isSw = lang === 'sw'

  const query = useQuery({
    queryKey: queryKeys.buyerNotifications(false),
    queryFn: () => listBuyerNotifications({ limit: 50 }),
    staleTime: 15_000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => markBuyerNotificationRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['buyer-notifications'],
      })
    },
  })

  const onTap = useCallback(
    (row: BuyerNotificationRow) => {
      if (!row.read_at) {
        markRead.mutate(row.id)
      }
      if (row.kind === 'rfb_fulfilled' && row.rfb_id) {
        router.push(`/rfb/${row.rfb_id}/sign-delivery`)
      }
    },
    [markRead, router],
  )

  const notifications = query.data?.notifications ?? []
  const inbox = useInbox()

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <View style={styles.padded}>
        <SectionHeader
          title={isSw ? 'Arifa' : 'Notifications'}
          subtitle={
            isSw
              ? 'Mabadiliko ya hivi karibuni katika manunuzi yako'
              : 'Recent activity on your purchases'
          }
        />
        {inbox.items.length > 0 ? (
          <LiveEventsRibbon items={inbox.items} unreadCount={inbox.unreadCount} isSw={isSw} />
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
            <Text style={styles.muted}>
              {isSw ? 'Inapakia arifa…' : 'Loading notifications…'}
            </Text>
          ) : query.isError ? (
            <Text style={styles.error}>
              {isSw
                ? 'Imeshindwa kupakia arifa.'
                : 'Failed to load notifications.'}
            </Text>
          ) : (
            <EmptyState
              message={
                isSw
                  ? 'Hakuna arifa. Tutakujulisha hapa muuzaji akimaliza RFB yako.'
                  : "No notifications. We'll alert you here when a seller fulfils your RFB."
              }
            />
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
          {new Date(row.created_at).toLocaleString(
            isSw ? 'sw-TZ' : 'en-US',
          )}
        </Text>
      </Card>
    </Pressable>
  )
}

interface LiveEventsRibbonProps {
  readonly items: ReadonlyArray<InboxItem>
  readonly unreadCount: number
  readonly isSw: boolean
}

function describeKind(kind: string, isSw: boolean): string {
  switch (kind) {
    case 'rfb.dispatched':
      return isSw ? 'RFB imepelekwa' : 'RFB dispatched'
    case 'bid.placed':
      return isSw ? 'Zabuni imewekwa' : 'Bid placed'
    case 'settlement.initiated':
      return isSw ? 'Malipo yameanza' : 'Settlement initiated'
    case 'chat.handoff':
      return isSw ? 'Mazungumzo yamepelekwa' : 'Chat handed off'
    case 'reminder.fired':
      return isSw ? 'Kikumbusho' : 'Reminder'
    default:
      return kind
  }
}

function LiveEventsRibbon({ items, unreadCount, isSw }: LiveEventsRibbonProps): JSX.Element {
  const recent = items.slice(0, 5)
  return (
    <View style={styles.ribbonWrap}>
      <View style={styles.ribbonHeader}>
        <Text style={styles.ribbonTitle}>
          {isSw ? 'Moja kwa moja' : 'Live'}{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </Text>
        {unreadCount > 0 ? (
          <Pressable onPress={() => markAllLiveRead()}>
            <Text style={styles.ribbonLink}>{isSw ? 'Soma zote' : 'Mark all read'}</Text>
          </Pressable>
        ) : null}
      </View>
      {recent.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => markLiveRead(item.id)}
        >
          <View style={styles.ribbonRow}>
            <Text style={styles.ribbonKind}>{describeKind(item.kind, isSw)}</Text>
            <Text style={styles.ribbonTime}>
              {new Date(item.emittedAt).toLocaleTimeString(isSw ? 'sw-TZ' : 'en-US')}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: tokens.color.bgBase,
  },
  ribbonWrap: {
    marginTop: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.space.sm,
    backgroundColor: tokens.color.bgRaised,
    borderWidth: 1,
    borderColor: tokens.color.bgMuted,
  },
  ribbonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space.xs,
  },
  ribbonTitle: {
    ...tokens.type.bodyStrong,
    color: tokens.color.gold,
  },
  ribbonLink: {
    ...tokens.type.bodySm,
    color: tokens.color.gold,
  },
  ribbonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: tokens.space.xs,
  },
  ribbonKind: {
    ...tokens.type.body,
    color: tokens.color.textPrimary,
  },
  ribbonTime: {
    ...tokens.type.bodySm,
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
