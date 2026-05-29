/**
 * Buyer-mobile in-memory inbox store.
 *
 * Mirrors workforce-mobile's pattern. Buyer-relevant cross-actor events
 * (RFB dispatched, bid placed, settlement initiated, chat handoffs,
 * reminders) are appended via `appendIncomingEvent`. Read state is
 * persisted in AsyncStorage so the badge survives a foreground/
 * background cycle.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

import type { BuyerEventKind as ImportedKind } from './event-stream'

export type BuyerEventKind = ImportedKind

export interface InboxItem {
  readonly id: string
  readonly kind: BuyerEventKind
  readonly tenantId: string
  readonly emittedAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

const MAX_ITEMS = 200
const READ_IDS_KEY = 'borjie.buyer.inbox.readIds.v1'

interface InboxState {
  readonly items: ReadonlyArray<InboxItem>
  readonly readIds: ReadonlySet<string>
}

let state: InboxState = {
  items: [],
  readIds: new Set<string>()
}

const subscribers = new Set<(s: InboxState) => void>()
let readIdsHydrated = false

function emit(): void {
  for (const sub of subscribers) {
    sub(state)
  }
}

function buildId(kind: BuyerEventKind, emittedAt: string): string {
  return `${kind}::${emittedAt}`
}

async function hydrateReadIds(): Promise<void> {
  if (readIdsHydrated) return
  readIdsHydrated = true
  try {
    const raw = await AsyncStorage.getItem(READ_IDS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return
    const ids = new Set<string>()
    for (const id of parsed) {
      if (typeof id === 'string') ids.add(id)
    }
    state = { ...state, readIds: ids }
    emit()
  } catch {
    // Corrupt store — start fresh.
  }
}

async function persistReadIds(): Promise<void> {
  try {
    await AsyncStorage.setItem(
      READ_IDS_KEY,
      JSON.stringify(Array.from(state.readIds))
    )
  } catch {
    // Best-effort.
  }
}

export interface AppendIncomingEventInput {
  readonly kind: BuyerEventKind
  readonly tenantId: string
  readonly emittedAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export function appendIncomingEvent(input: AppendIncomingEventInput): void {
  const id = buildId(input.kind, input.emittedAt)
  if (state.items.some((it) => it.id === id)) return
  const next: InboxItem = {
    id,
    kind: input.kind,
    tenantId: input.tenantId,
    emittedAt: input.emittedAt,
    payload: input.payload
  }
  const items = [next, ...state.items]
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS
  state = { ...state, items }
  emit()
}

export function markRead(id: string): void {
  if (state.readIds.has(id)) return
  const readIds = new Set(state.readIds)
  readIds.add(id)
  state = { ...state, readIds }
  emit()
  void persistReadIds()
}

export function markAllRead(): void {
  const readIds = new Set(state.readIds)
  let changed = false
  for (const it of state.items) {
    if (!readIds.has(it.id)) {
      readIds.add(it.id)
      changed = true
    }
  }
  if (!changed) return
  state = { ...state, readIds }
  emit()
  void persistReadIds()
}

export function clearAll(): void {
  state = { items: [], readIds: new Set<string>() }
  emit()
  void AsyncStorage.removeItem(READ_IDS_KEY).catch(() => undefined)
}

export interface UseInboxValue {
  readonly items: ReadonlyArray<InboxItem>
  readonly unreadCount: number
}

export function useInbox(): UseInboxValue {
  const [snapshot, setSnapshot] = useState<InboxState>(state)
  useEffect(() => {
    void hydrateReadIds()
    const handler = (next: InboxState): void => setSnapshot(next)
    subscribers.add(handler)
    setSnapshot(state)
    return () => {
      subscribers.delete(handler)
    }
  }, [])
  let unread = 0
  for (const it of snapshot.items) {
    if (!snapshot.readIds.has(it.id)) unread += 1
  }
  return { items: snapshot.items, unreadCount: unread }
}

export function __resetInboxForTests(): void {
  state = { items: [], readIds: new Set<string>() }
  subscribers.clear()
  readIdsHydrated = false
}
