import { miningApi, type MiningApi } from '../api/client'
import { ApiError } from '../api/errors'
import { endpointFor } from './endpoints'
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
  skipped: boolean
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
 * Drain the queue once. For each entry: POST to
 * `${API_BASE_URL}/api/v1/mining/<endpoint>`, where `<endpoint>` is derived
 * from the entity type via `endpointFor`. On 2xx the entry is treated as
 * synced and removed from local storage. On retryable failure the attempt
 * counter increments and the entry stays. On terminal failure (4xx other
 * than 408/429, or exhausted attempts) the entry is dropped with a logged
 * error so we never loop forever on a poisoned payload.
 *
 * Accepts an optional `apiClient` so tests can inject a stub. Defaults to
 * the real `miningApi` wrapper.
 */
export async function flushQueue(
  apiClient: Pick<MiningApi, 'post'> = miningApi
): Promise<FlushResult> {
  const queued = await listQueued()
  let succeeded = 0
  let failed = 0
  for (const entry of queued) {
    const path = endpointFor(entry.entityType)
    try {
      await apiClient.post(path, entry.payload)
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
    remaining,
    skipped: false
  }
}

export function isFlushable(entry: QueuedWrite): boolean {
  return entry.attempts < MAX_ATTEMPTS
}
