import { fieldApi } from '../api/client'
import { ApiError } from '../api/errors'
import { ENTITY_ENDPOINTS } from './endpoints'
import {
  listQueued,
  recordAttempt,
  removeFromQueue,
  type QueuedWrite
} from './queue'

export interface FlushResult {
  attempted: number
  succeeded: number
  failed: number
  remaining: number
}

const MAX_ATTEMPTS = 5

function shouldDrop(error: unknown): boolean {
  // 4xx errors (except 408/429) mean the payload itself is wrong — drop it
  // rather than loop forever. Server-side 5xx and network errors get retried.
  if (!(error instanceof ApiError)) {
    return false
  }
  if (error.status === 0) {
    return false
  }
  if (error.status === 408 || error.status === 429) {
    return false
  }
  return error.status >= 400 && error.status < 500
}

/**
 * Drain the queue once. Pull entries one at a time and POST to the field API.
 * On success: remove. On retryable failure: record attempt. On terminal
 * failure (4xx) or exhausted attempts: drop with logged error.
 */
export async function flushQueue(): Promise<FlushResult> {
  const queued = await listQueued()
  let succeeded = 0
  let failed = 0
  for (const entry of queued) {
    const path = ENTITY_ENDPOINTS[entry.entityType]
    try {
      await fieldApi.post(path, entry.payload)
      await removeFromQueue(entry.id)
      succeeded += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (shouldDrop(error) || entry.attempts + 1 >= MAX_ATTEMPTS) {
        console.error(
          `Dropping queued ${entry.entityType} ${entry.id}: ${message}`
        )
        await removeFromQueue(entry.id)
        continue
      }
      await recordAttempt(entry.id, message)
    }
  }
  const remaining = (await listQueued()).length
  return {
    attempted: queued.length,
    succeeded,
    failed,
    remaining
  }
}

export function isFlushable(entry: QueuedWrite): boolean {
  return entry.attempts < MAX_ATTEMPTS
}
