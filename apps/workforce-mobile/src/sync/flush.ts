import { miningApi, type MiningApi } from '../api/client'
import { ApiError } from '../api/errors'
import { endpointFor } from './endpoints'
import { uploadLocalMedia, isLocalUri } from './mediaUpload'
import {
  listQueued,
  recordAttempt,
  removeFromQueue,
  quarantineToDeadLetter,
  type QueuedWrite
} from './queue'

export interface FlushResult {
  attempted: number
  succeeded: number
  failed: number
  remaining: number
  skipped: boolean
}

/**
 * The single store location offline issues/returns resolve against. MUST match
 * the online W-M-10 path (`warehouse.router.ts` DEFAULT_STORE_LOCATION_ID) so a
 * move reconciles to the same on-hand whether it synced online or via flush.
 */
const DEFAULT_STORE_LOCATION_ID = 'default-store'

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
 * Map a queued `inventory_move` payload onto the gateway's `MovementSchema`
 * (the body the ONLINE W-M-10 flow already posts to `POST
 * /inventory/movements`). Offline and online thus converge on one mounted
 * route + one table (`inventory_stock_movements`) — no divergent
 * `/inventory-moves` endpoint, no 404, no silent loss.
 *
 * If the stored payload already carries a `type` (i.e. it was captured in the
 * gateway shape) it passes through unchanged. Otherwise a worker-friendly
 * shape ({ skuId, direction|action, quantity, locationId?, fromLocationId?,
 * reference?, notes? }) is normalised: `direction`/`action` of
 * `in|receipt|received` → receipt, `out|issue|issued` → issue, anything else
 * → adjustment (signed `delta`).
 */
function prepareInventoryMoveBody(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) {
    return {}
  }
  const p = payload as Record<string, unknown>
  if (typeof p.type === 'string') {
    // Already in the gateway shape — pass through.
    return p
  }
  // W-M-10 enqueue shape: { warehouseItemId, movementType: 'issue' | 'return',
  // quantityDelta, reason }. This is what the live W-M-10 screen actually
  // queues on an offline issue/return. Map it onto `MovementSchema` so the
  // offline retry hits the SAME route + table + store location as the online
  // POST — `warehouseItemId` is the SKU id, and the issue/return both resolve
  // against `default-store` (the warehouse router's DEFAULT_STORE_LOCATION_ID),
  // so on-hand reconciles whether the move synced online or via this flush.
  if (typeof p.warehouseItemId === 'string') {
    const movementType = String(p.movementType ?? '').toLowerCase()
    const quantity = Math.abs(Number(p.quantityDelta ?? 0))
    const base: Record<string, unknown> = {
      skuId: p.warehouseItemId,
      ...(p.reason !== undefined ? { reference: p.reason } : {})
    }
    if (movementType === 'return' || movementType === 'in' || movementType === 'receipt') {
      return { ...base, type: 'receipt', locationId: DEFAULT_STORE_LOCATION_ID, quantity }
    }
    // 'issue' — and any unknown movementType defaults to the conservative
    // issue path (decrement), never a silent drop.
    return { ...base, type: 'issue', fromLocationId: DEFAULT_STORE_LOCATION_ID, quantity }
  }
  const direction = String(p.direction ?? p.action ?? 'adjustment').toLowerCase()
  const base: Record<string, unknown> = {
    skuId: p.skuId,
    ...(p.reference !== undefined ? { reference: p.reference } : {}),
    ...(p.notes !== undefined ? { notes: p.notes } : {})
  }
  if (direction === 'in' || direction === 'receipt' || direction === 'received') {
    return {
      ...base,
      type: 'receipt',
      locationId: p.locationId ?? p.toLocationId,
      quantity: p.quantity
    }
  }
  if (direction === 'out' || direction === 'issue' || direction === 'issued') {
    return {
      ...base,
      type: 'issue',
      fromLocationId: p.fromLocationId ?? p.locationId,
      quantity: p.quantity
    }
  }
  return {
    ...base,
    type: 'adjustment',
    locationId: p.locationId,
    delta: p.delta
  }
}

/**
 * Resolve the POST body for a queued entry. Most entities POST their
 * stored payload verbatim; `shift_report` is transformed so its captured
 * media is uploaded and the body matches the gateway schema, and
 * `inventory_move` is normalised onto the online movement schema so offline
 * and online converge on one route.
 */
async function bodyFor(entry: QueuedWrite): Promise<unknown> {
  if (entry.entityType === 'shift_report' && isShiftReportPayload(entry.payload)) {
    return prepareShiftReportBody(entry.payload)
  }
  if (entry.entityType === 'inventory_move') {
    return prepareInventoryMoveBody(entry.payload)
  }
  return entry.payload
}

/**
 * Statuses that mean the WORKER'S OWN PAYLOAD is genuinely rejected — the
 * record can never succeed no matter how many times it is retried, so it is
 * safe to drop it from the live queue.
 *
 *   400 Bad Request          — malformed body / failed validation
 *   409 Conflict             — already-applied / duplicate (idempotent reject)
 *   422 Unprocessable Entity — semantically invalid input
 *
 * EVERYTHING ELSE IS RETRYABLE and must NEVER drop a record:
 *   - 404 Not Found          — the SINK ROUTE is not (yet) mounted. This is a
 *                              SERVER/deploy problem, not a bad payload. The
 *                              record's evidence is intact; dropping it here is
 *                              exactly the data-loss root cause this fixes.
 *   - 401/403                — auth/token not ready; retry after re-auth.
 *   - 408/429                — timeout / rate-limited; back off and retry.
 *   - any 5xx                — transient server fault; retry.
 *   - status 0 (network)     — offline; retry on the next flush.
 *
 * A record is removed without a server 2xx ONLY on a genuine payload
 * rejection. Irreplaceable offline mine evidence is never silently deleted.
 */
const TERMINAL_REJECTION_STATUSES: ReadonlySet<number> = new Set([400, 409, 422])

function shouldDrop(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false
  }
  return TERMINAL_REJECTION_STATUSES.has(error.status)
}

/**
 * Drain the queue once. For each entry: POST to
 * `${API_BASE_URL}/api/v1/mining/<endpoint>`, where `<endpoint>` is derived
 * from the entity type via `endpointFor`. On 2xx the entry is treated as
 * synced and removed from local storage.
 *
 * Failure handling preserves irreplaceable field evidence:
 *   - GENUINE payload rejection (400/409/422): the worker's own input can
 *     never succeed, so the entry is dropped.
 *   - Retryable failure (404 unmounted-route / 5xx / network / auth): the
 *     attempt counter increments and the entry STAYS. A 404 is treated as a
 *     server/deploy problem, never as a reason to delete the evidence.
 *   - Retry budget exhausted: the entry is QUARANTINED to the durable
 *     dead-letter store, never silently deleted.
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
      // The queue entry's stable id is the natural idempotency key: an
      // at-least-once re-flush (e.g. after a crash between POST and
      // removeFromQueue) carries the SAME key, so the sink can no-op the
      // replay instead of double-recording the worker's evidence.
      await apiClient.post(path, body, {
        headers: { 'Idempotency-Key': entry.id }
      })
      await removeFromQueue(entry.id)
      succeeded += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : 'Unknown error'
      // GENUINE payload rejection (400/409/422) — the body is the worker's
      // own malformed/duplicate input; it can never succeed, so drop it.
      // A 404 is NOT a rejection (it means the sink route is unmounted) and
      // is handled by the retryable branch below — never dropped here.
      if (shouldDrop(error)) {
        console.error(
          `Rejecting queued ${entry.entityType} ${entry.id} (payload rejected): ${message}`
        )
        await removeFromQueue(entry.id)
        continue
      }
      // Retryable failure (404 / 5xx / network / auth-not-ready). On budget
      // exhaustion the record is QUARANTINED to the durable dead-letter store,
      // never silently deleted — irreplaceable field evidence is preserved so
      // it can be re-driven once the sink route is live again.
      if (entry.attempts + 1 >= MAX_ATTEMPTS) {
        console.error(
          `Quarantining queued ${entry.entityType} ${entry.id} after ${MAX_ATTEMPTS} attempts: ${message}`
        )
        await quarantineToDeadLetter(entry.id, message)
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
