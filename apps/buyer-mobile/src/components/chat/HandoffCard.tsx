/**
 * HandoffCard — buyer-mobile renderer for the K-A cross-role handoff.
 *
 * Mirrors apps/workforce-mobile/src/components/chat/HandoffCard.tsx
 * so the buyer sees the same model when a seller / owner / concierge
 * routes them a contextual handoff ("Re: 50t cobalt buy request").
 *
 * Bilingual sw/en per the Borjie hard rule.
 */

import type { ReactElement } from 'react'
import { useCallback, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export interface IncomingHandoff {
  readonly id: string
  readonly sourceUserId: string
  readonly sourceDisplayName?: string
  readonly sourceRole?: string
  readonly topic: string
  readonly scopePayload?: {
    readonly entityKind?: string
    readonly entityId?: string
    readonly category?: string
    readonly [key: string]: unknown
  }
  readonly resolution: 'pending' | 'replied' | 'closed' | 'declined'
  readonly createdAt: string
}

export interface HandoffCardProps {
  readonly handoff: IncomingHandoff
  readonly language?: 'en' | 'sw'
  readonly onReply?: (handoff: IncomingHandoff) => void
  readonly onClose?: (handoff: IncomingHandoff) => void
}

const COPY = {
  en: {
    from: 'From',
    re: 'Re:',
    item: 'Item:',
    category: 'Topic:',
    reply: 'Reply',
    close: 'Close',
    pending: 'Awaiting your action',
    closed: 'Closed',
    declined: 'Declined',
    replied: 'You have replied',
  },
  sw: {
    from: 'Kutoka',
    re: 'Kuhusu:',
    item: 'Bidhaa:',
    category: 'Mada:',
    reply: 'Jibu',
    close: 'Funga',
    pending: 'Inakusubiri',
    closed: 'Imefungwa',
    declined: 'Imekataliwa',
    replied: 'Umejibu',
  },
} as const

function relativeTime(iso: string, lang: 'en' | 'sw'): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - then) / 1000))
  if (diffSec < 60) return lang === 'sw' ? `${diffSec}s zilizopita` : `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return lang === 'sw' ? `${diffMin}m zilizopita` : `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return lang === 'sw' ? `${diffHr}h zilizopita` : `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return lang === 'sw' ? `${diffDay}d zilizopita` : `${diffDay}d ago`
}

export function HandoffCard({
  handoff,
  language = 'en',
  onReply,
  onClose,
}: HandoffCardProps): ReactElement {
  const lang: 'en' | 'sw' = language === 'sw' ? 'sw' : 'en'
  const copy = COPY[lang]
  const sourceName = handoff.sourceDisplayName ?? handoff.sourceUserId
  const when = useMemo(() => relativeTime(handoff.createdAt, lang), [handoff.createdAt, lang])
  const isPending = handoff.resolution === 'pending'

  const statusLabel =
    handoff.resolution === 'replied'
      ? copy.replied
      : handoff.resolution === 'closed'
        ? copy.closed
        : handoff.resolution === 'declined'
          ? copy.declined
          : copy.pending

  const handleReply = useCallback(() => onReply?.(handoff), [handoff, onReply])
  const handleClose = useCallback(() => onClose?.(handoff), [handoff, onClose])

  return (
    <View accessibilityRole="summary" accessibilityLabel={`handoff from ${sourceName}`} style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {copy.from} {sourceName}
        </Text>
        <Text style={styles.timestamp}>{when}</Text>
      </View>
      <Text style={styles.topic}>
        <Text style={styles.label}>{copy.re} </Text>
        {handoff.topic}
      </Text>
      {handoff.scopePayload?.entityKind && handoff.scopePayload.entityId ? (
        <Text style={styles.meta}>
          {copy.item} {handoff.scopePayload.entityKind}#{handoff.scopePayload.entityId}
        </Text>
      ) : null}
      {handoff.scopePayload?.category ? (
        <Text style={styles.meta}>
          {copy.category} {handoff.scopePayload.category}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {isPending ? (
          <>
            <Pressable accessibilityRole="button" onPress={handleReply} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnPrimaryText}>{copy.reply}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={handleClose} style={[styles.btn, styles.btnSecondary]}>
              <Text style={styles.btnSecondaryText}>{copy.close}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.status}>{statusLabel}</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#2a2a32',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    backgroundColor: '#16161c',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  headerText: { color: '#e7e7ea', fontWeight: '600', fontSize: 13 },
  timestamp: { color: '#a3a3a8', fontSize: 11 },
  topic: { color: '#e7e7ea', fontSize: 13, marginBottom: 6 },
  label: { fontWeight: '700' },
  meta: { color: '#a3a3a8', fontSize: 11, marginTop: 2 },
  actions: { flexDirection: 'row', marginTop: 10, gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  btnPrimary: { backgroundColor: '#d4af37' },
  btnSecondary: { borderWidth: 1, borderColor: '#3a3a42' },
  btnPrimaryText: { color: '#0d0d10', fontWeight: '700' },
  btnSecondaryText: { color: '#e7e7ea' },
  status: { color: '#a3a3a8', fontStyle: 'italic', fontSize: 12 },
})
