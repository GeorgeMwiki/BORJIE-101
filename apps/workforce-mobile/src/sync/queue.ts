import AsyncStorage from '@react-native-async-storage/async-storage'

const QUEUE_KEY = 'borjie.sync.queue.v1'

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
  } catch {
    // Storage failure: surface via getQueueSize() warning UX in a later phase.
  }
}

/**
 * Enqueue a write that will be flushed to the backend when connectivity
 * returns. Pure stub: never attempts network. The flush implementation will
 * land alongside the API client work.
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
