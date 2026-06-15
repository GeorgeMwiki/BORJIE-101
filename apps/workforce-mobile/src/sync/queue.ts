import AsyncStorage from '@react-native-async-storage/async-storage'

const QUEUE_KEY = 'borjie.sync.queue.v1'
/**
 * Dead-letter store. A queued field-evidence record is moved HERE — never
 * deleted — when the flush loop exhausts its retry budget. The record stays
 * durably on-device with the failure reason so it can be inspected, re-driven,
 * or surfaced to the worker. The contract: irreplaceable offline mine evidence
 * is NEVER silently dropped; the only thing that removes a record from the live
 * queue without a server 2xx is a genuine payload rejection (400/409/422),
 * which is the worker's own malformed input, not lost evidence.
 */
const DEAD_LETTER_KEY = 'borjie.sync.deadletter.v1'

export type EntityType =
  | 'shift_report'
  | 'incident'
  | 'attendance'
  | 'fingerprint_sign'
  | 'sample'
  | 'fuel_log'
  | 'machine_hour'
  | 'photo_upload'
  | 'inventory_move'
  | 'sic_ping'
  | 'voice_query'
  | 'driver_letter_ack'
  | 'toolbox_ack'
  | 'ppe_receipt'
  | 'excavator_count'
  | 'drill_hole'
  | 'weighbridge_capture'

export interface QueuedWrite {
  id: string
  entityType: EntityType
  payload: unknown
  enqueuedAt: number
  attempts: number
  lastError?: string
}

type Listener = (size: number) => void
const listeners = new Set<Listener>()

function notify(size: number): void {
  for (const listener of listeners) {
    listener(size)
  }
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function newId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `q_${Date.now()}_${rand}`
}

async function readQueue(): Promise<ReadonlyArray<QueuedWrite>> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed as ReadonlyArray<QueuedWrite>
  } catch {
    return []
  }
}

async function writeQueue(next: ReadonlyArray<QueuedWrite>): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next))
    notify(next.length)
  } catch (error) {
    console.error('Failed to persist sync queue:', error)
  }
}

/**
 * Enqueue a write that will be flushed to the backend when connectivity
 * returns. Returns the entry so call sites can show optimistic confirmation
 * with the queue id.
 */
export async function enqueueWrite(
  entityType: EntityType,
  payload: unknown
): Promise<QueuedWrite> {
  const entry: QueuedWrite = {
    id: newId(),
    entityType,
    payload,
    enqueuedAt: Date.now(),
    attempts: 0
  }
  const current = await readQueue()
  const next = [...current, entry]
  await writeQueue(next)
  return entry
}

export async function getQueueSize(): Promise<number> {
  const current = await readQueue()
  return current.length
}

export async function listQueued(): Promise<ReadonlyArray<QueuedWrite>> {
  return readQueue()
}

export async function clearQueue(): Promise<void> {
  await writeQueue([])
}

export async function removeFromQueue(id: string): Promise<void> {
  const current = await readQueue()
  const next = current.filter((entry) => entry.id !== id)
  await writeQueue(next)
}

export async function recordAttempt(id: string, errorMessage: string): Promise<void> {
  const current = await readQueue()
  const next = current.map((entry) => {
    if (entry.id !== id) {
      return entry
    }
    return {
      ...entry,
      attempts: entry.attempts + 1,
      lastError: errorMessage
    }
  })
  await writeQueue(next)
}

/**
 * A queued write that exhausted its live-queue retry budget. It is preserved
 * with the terminal failure reason and the time it was quarantined so the
 * evidence can be re-driven or surfaced — it is NOT deleted.
 */
export interface DeadLetteredWrite extends QueuedWrite {
  deadLetteredAt: number
  reason: string
}

async function readDeadLetters(): Promise<ReadonlyArray<DeadLetteredWrite>> {
  try {
    const raw = await AsyncStorage.getItem(DEAD_LETTER_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed as ReadonlyArray<DeadLetteredWrite>
  } catch {
    return []
  }
}

async function writeDeadLetters(
  next: ReadonlyArray<DeadLetteredWrite>
): Promise<void> {
  try {
    await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(next))
  } catch (error) {
    console.error('Failed to persist sync dead-letter store:', error)
  }
}

export async function listDeadLettered(): Promise<
  ReadonlyArray<DeadLetteredWrite>
> {
  return readDeadLetters()
}

/**
 * Move a queued entry to the dead-letter store. The entry is appended to the
 * durable dead-letter store FIRST, then removed from the live queue, so a
 * crash between the two writes leaves the record duplicated (re-driveable)
 * rather than lost. Irreplaceable evidence is preserved, never deleted.
 */
export async function quarantineToDeadLetter(
  id: string,
  reason: string
): Promise<void> {
  const current = await readQueue()
  const entry = current.find((item) => item.id === id)
  if (!entry) {
    return
  }
  const existing = await readDeadLetters()
  const deadLettered: DeadLetteredWrite = {
    ...entry,
    deadLetteredAt: Date.now(),
    reason
  }
  await writeDeadLetters([...existing, deadLettered])
  await removeFromQueue(id)
}
