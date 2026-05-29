/**
 * Workforce-mobile — notifications inbox.
 *
 * Displays the live SSE stream the app has consumed during the current
 * foreground session (`@/lib/notifications/inbox-store`). Tap any row to
 * mark it read; the unread count drives a future badge on the tab bar.
 *
 * Bilingual sw/en. Owner / manager / worker users all see this screen;
 * the kind labels and deep links are role-aware.
 *
 * Out-of-foreground delivery happens via push notifications to the
 * device's Expo push token (registered by
 * `@/lib/notifications/push-register`).
 */

import { useCallback } from 'react'
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useRouter } from 'expo-router'

import { useI18n } from '../../src/i18n/useI18n'
import { tokens } from '../../src/ui-litfin'
import {
  useInbox,
  markRead,
  markAllRead,
  type InboxItem,
  type WorkforceEventKind
} from '../../src/lib/notifications/inbox-store'

type DeepLink = {
  readonly href: string
}

function describeKind(kind: WorkforceEventKind, sw: boolean): string {
  switch (kind) {
    case 'task.assigned':
      return sw ? 'Umepewa kazi' : 'Task assigned to you'
    case 'manager.approved':
      return sw ? 'Meneja amekubali' : 'Manager approved'
    case 'safety.incident_reported':
      return sw ? 'Tukio la usalama limeripotiwa' : 'Safety incident reported'
    case 'incident.escalated':
      return sw ? 'Tukio limepelekwa juu' : 'Incident escalated'
    case 'payroll.committed':
      return sw ? 'Umelipwa' : 'You have been paid'
    case 'chat.handoff':
      return sw ? 'Mazungumzo yamepelekwa' : 'Chat handed off to you'
    case 'rfb.dispatched':
      return sw ? 'RFB imepelekwa' : 'RFB dispatched'
    case 'workforce.shift_event':
      return sw ? 'Mabadiliko ya zamu' : 'Shift event'
    case 'mwikila.acted':
      return sw ? 'Mwikila ametenda' : 'Mwikila acted'
    case 'mwikila.proposes':
      return sw ? 'Mwikila anapendekeza' : 'Mwikila proposes'
    case 'reminder.fired':
      return sw ? 'Kikumbusho' : 'Reminder'
    default:
      return kind
  }
}

function describeBody(item: InboxItem, sw: boolean): string {
  const payload = item.payload as Record<string, unknown>
  if (item.kind === 'task.assigned') {
    const title = typeof payload.title === 'string' ? payload.title : ''
    const priority = typeof payload.priority === 'string' ? payload.priority : ''
    return [title, priority].filter(Boolean).join(' · ')
  }
  if (item.kind === 'safety.incident_reported' || item.kind === 'incident.escalated') {
    const summary = typeof payload.summary === 'string' ? payload.summary : ''
    const severity = typeof payload.severity === 'string' ? payload.severity : ''
    return [summary, severity].filter(Boolean).join(' · ')
  }
  if (item.kind === 'payroll.committed') {
    const net = typeof payload.netTotalTzs === 'number' ? payload.netTotalTzs : 0
    return sw
      ? `Jumla halisi TZS ${net.toLocaleString('sw-TZ')}`
      : `Net total TZS ${net.toLocaleString('en-US')}`
  }
  if (item.kind === 'rfb.dispatched') {
    const siteId = typeof payload.siteId === 'string' ? payload.siteId : ''
    return sw ? `Tovuti: ${siteId}` : `Site: ${siteId}`
  }
  return ''
}

function deepLinkFor(item: InboxItem): DeepLink | null {
  const payload = item.payload as Record<string, unknown>
  if (item.kind === 'task.assigned') {
    const id = typeof payload.taskId === 'string' ? payload.taskId : null
    if (id) return { href: `/(worker)/task/${id}` }
  }
  if (item.kind === 'safety.incident_reported' || item.kind === 'incident.escalated') {
    const id = typeof payload.incidentId === 'string' ? payload.incidentId : null
    if (id) return { href: `/(worker)/incident-report` }
  }
  if (item.kind === 'payroll.committed') {
    return { href: `/(worker)/payslip` }
  }
  if (item.kind === 'rfb.dispatched') {
    const id = typeof payload.rfbId === 'string' ? payload.rfbId : null
    if (id) return { href: `/(manager)/rfb/${id}` }
  }
  return null
}

export default function NotificationsInbox(): JSX.Element {
  const router = useRouter()
  const { lang } = useI18n()
  const sw = lang === 'sw'
  const inbox = useInbox()

  const onTap = useCallback(
    (item: InboxItem) => {
      markRead(item.id)
      const link = deepLinkFor(item)
      if (link) {
        router.push(link.href as never)
      }
    },
    [router]
  )

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <Stack.Screen options={{ title: sw ? 'Arifa' : 'Notifications' }} />
      <View style={styles.header}>
        <Text style={styles.title}>{sw ? 'Arifa' : 'Notifications'}</Text>
        <Text style={styles.subtitle}>
          {sw
            ? 'Mabadiliko ya papo hapo kutoka kwa meneja, mmiliki na Mr. Mwikila.'
            : 'Live activity from your manager, the owner and Mr. Mwikila.'}
        </Text>
        {inbox.unreadCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => markAllRead()}
            style={styles.markAllBtn}
          >
            <Text style={styles.markAllLabel}>
              {sw
                ? `Soma zote (${inbox.unreadCount})`
                : `Mark all read (${inbox.unreadCount})`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={inbox.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={false}
            tintColor={tokens.color.gold}
            onRefresh={() => undefined}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>
              {sw ? 'Hakuna arifa bado' : 'No notifications yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {sw
                ? 'Tutaonyesha kazi mpya, vikumbusho na arifa za usalama hapa.'
                : 'New tasks, reminders and safety alerts will appear here.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Row
            item={item}
            sw={sw}
            onPress={() => onTap(item)}
            unread={!inbox.readIds.has(item.id)}
          />
        )}
      />
    </SafeAreaView>
  )
}

interface RowProps {
  readonly item: InboxItem
  readonly sw: boolean
  readonly onPress: () => void
  readonly unread: boolean
}

function Row({ item, sw, onPress, unread }: RowProps): JSX.Element {
  const link = deepLinkFor(item)
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.rowHeader}>
        {unread ? <View style={styles.unreadDot} /> : null}
        <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]}>
          {describeKind(item.kind, sw)}
        </Text>
      </View>
      <Text style={styles.rowBody}>{describeBody(item, sw)}</Text>
      <View style={styles.rowFooter}>
        <Text style={styles.rowTime}>
          {new Date(item.emittedAt).toLocaleString(sw ? 'sw-TZ' : 'en-US')}
        </Text>
        {link ? (
          <Text style={styles.rowAction}>{sw ? 'Fungua' : 'Open'}</Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: tokens.color.bgSurface
  },
  header: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.md,
    gap: tokens.space.xs
  },
  title: {
    ...tokens.type.h1,
    color: tokens.color.textPrimary
  },
  subtitle: {
    ...tokens.type.body,
    color: tokens.color.textSecondary
  },
  markAllBtn: {
    marginTop: tokens.space.sm,
    alignSelf: 'flex-start',
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.space.sm,
    borderWidth: 1,
    borderColor: tokens.color.gold
  },
  markAllLabel: {
    ...tokens.type.bodySm,
    color: tokens.color.gold
  },
  list: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxxl,
    gap: tokens.space.sm
  },
  row: {
    padding: tokens.space.md,
    borderRadius: tokens.space.sm,
    backgroundColor: tokens.color.bgRaised,
    borderWidth: 1,
    borderColor: tokens.color.bgMuted
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.color.gold
  },
  rowTitle: {
    ...tokens.type.bodyStrong,
    color: tokens.color.textPrimary,
    flex: 1
  },
  rowTitleUnread: {
    color: tokens.color.gold
  },
  rowBody: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.xs
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: tokens.space.xs
  },
  rowTime: {
    ...tokens.type.bodySm,
    color: tokens.color.textMuted
  },
  rowAction: {
    ...tokens.type.bodySm,
    color: tokens.color.gold
  },
  emptyWrap: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.xxl
  },
  emptyTitle: {
    ...tokens.type.h3,
    color: tokens.color.textPrimary
  },
  emptyBody: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.xs
  }
})
