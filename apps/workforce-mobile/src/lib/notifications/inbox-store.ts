/**
 * Workforce-mobile in-memory inbox store.
 *
 * The api-gateway publishes cross-actor events over SSE; this module
 * keeps an in-memory ring of every event the app has seen during the
 * current foreground session and exposes them as a sorted list to the
 * notifications screen + the unread-count badge.
 *
 * Persistence:
 *   - Read/unread markers are persisted in AsyncStorage under the
 *     `borjie.workforce.inbox.readIds.v1` key so a foreground/background/
 *     foreground cycle preserves the read state.
 *   - The event payloads themselves are NOT persisted — when the app is
 *     backgrounded the SSE socket is closed and any missed events are
 *     delivered via push notifications instead.
 *
 * Concurrency:
 *   - Single writer per app instance (the EventStreamMount component).
 *   - Subscribers re-render through a React subscription pattern.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

import type { WorkforceEventKind as ImportedKind } from './event-stream'

export type WorkforceEventKind = ImportedKind

export interface InboxItem {
  readonly id: string
  readonly kind: WorkforceEventKind
  readonly tenantId: string
  readonly emittedAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

const MAX_ITEMS = 200
const READ_IDS_KEY = 'borjie.workforce.inbox.readIds.v1'

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

function buildId(kind: WorkforceEventKind, emittedAt: string): string {
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
    // Best-effort persistence; never block UI.
  }
}

export interface AppendIncomingEventInput {
  readonly kind: WorkforceEventKind
  readonly tenantId: string
  readonly emittedAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export function appendIncomingEvent(input: AppendIncomingEventInput): void {
  const id = buildId(input.kind, input.emittedAt)
  // Skip duplicates (the SSE socket sometimes redelivers on reconnect).
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

/**
 * React subscription hook. Re-renders the consumer whenever the inbox
 * state changes (new event arrived, mark-read tap, etc.).
 */
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

/** Test helper — wipe in-memory state. */
export function __resetInboxForTests(): void {
  state = { items: [], readIds: new Set<string>() }
  subscribers.clear()
  readIdsHydrated = false
}
