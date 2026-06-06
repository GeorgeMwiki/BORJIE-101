import { miningApi, type MiningApi } from '../api/client'
import { ApiError } from '../api/errors'
import { endpointFor } from './endpoints'
import { uploadLocalMedia, isLocalUri } from './mediaUpload'
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

interface LocalMediaRef {
  readonly uri: string
  readonly mimeType: string
}

interface LocalShiftReportPayload {
  readonly siteId: string
  readonly workersCount: number
  readonly hoursPerWorker: number
  readonly fuelLitres: number
  readonly equipmentNotes: string
  readonly blockers: string
  readonly photos: ReadonlyArray<LocalMediaRef & { readonly capturedAt: number }>
  readonly voiceNote: (LocalMediaRef & { readonly durationMs: number }) | null
  readonly submittedAt: number
}

function isShiftReportPayload(value: unknown): value is LocalShiftReportPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'siteId' in value &&
    'photos' in value &&
    Array.isArray((value as { photos: unknown }).photos)
  )
}

/**
 * Resolve a shift-report's local media to stored document refs and map the
 * on-device capture shape onto the gateway's `CreateShiftReportRequest`
 * body. Any media still on a `file://` / `content://` URI is uploaded
 * first (presigned PUT); a failure there throws so the flush loop keeps
 * the entry queued and retries — binaries are never dropped.
 */
async function prepareShiftReportBody(
  payload: LocalShiftReportPayload
): Promise<Record<string, unknown>> {
  const photoRefs: string[] = []
  for (const photo of payload.photos) {
    if (isLocalUri(photo.uri)) {
      const ref = await uploadLocalMedia(photo.uri, photo.mimeType, [
        'shift_report',
        'photo'
      ])
      photoRefs.push(ref)
    } else {
      photoRefs.push(photo.uri)
    }
  }

  let voiceNoteRef: string | undefined
  if (payload.voiceNote) {
    voiceNoteRef = isLocalUri(payload.voiceNote.uri)
      ? await uploadLocalMedia(payload.voiceNote.uri, payload.voiceNote.mimeType, [
          'shift_report',
          'voice'
        ])
      : payload.voiceNote.uri
  }

  const shiftDate = new Date(payload.submittedAt).toISOString().slice(0, 10)
  const notes = [payload.blockers, payload.equipmentNotes]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' · ')

  return {
    siteId: payload.siteId,
    shiftDate,
    shiftKind: 'day',
    workersPresent: payload.workersCount,
    fuelLitres: String(payload.fuelLitres),
    photos: photoRefs,
    ...(voiceNoteRef ? { voiceNoteRef } : {}),
    ...(notes.length > 0 ? { nextShiftPlan: notes } : {})
  }
}

/**
 * Resolve the POST body for a queued entry. Most entities POST their
 * stored payload verbatim; `shift_report` is transformed so its captured
 * media is uploaded and the body matches the gateway schema.
 */
async function bodyFor(entry: QueuedWrite): Promise<unknown> {
  if (entry.entityType === 'shift_report' && isShiftReportPayload(entry.payload)) {
    return prepareShiftReportBody(entry.payload)
  }
  return entry.payload
}

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
    // Build the request body first. For entities with captured media this
    // uploads the binaries (presigned PUT) and rewrites local URIs to
    // stored refs. A media-upload failure must NEVER drop the entry — the
    // worker's evidence stays queued for the next flush regardless of the
    // attempt counter.
    let body: unknown
    try {
      body = await bodyFor(entry)
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : 'Media upload failed'
      await recordAttempt(entry.id, message)
      continue
    }
    try {
      await apiClient.post(path, body)
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
