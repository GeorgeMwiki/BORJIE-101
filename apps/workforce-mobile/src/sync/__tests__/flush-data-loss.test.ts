/**
 * Red -> green guard for the offline-field-capture data-loss BLOCKER.
 *
 * THE BUG: the sync flush layer classified ANY 4xx (including a 404 from an
 * unmounted sink route) as terminal and DELETED the queued record on the first
 * reconnect flush, silently and permanently losing irreplaceable mine field
 * evidence after the UI already showed a "saved offline" confirmation.
 *
 * These tests assert the fixed contract:
 *   - a 404 NEVER deletes a queued record (it retries; evidence is preserved);
 *   - 5xx / network errors also retry, never delete;
 *   - a genuine payload rejection (400/409/422) DOES drop the record;
 *   - on retry-budget exhaustion the record is QUARANTINED to the durable
 *     dead-letter store, never silently deleted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory AsyncStorage so the real queue helpers actually persist.
const store = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
}))

// Keep the module graph free of native deps pulled in transitively.
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } }
}))
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}))

import type { MiningApi } from '../../api/client'
import { ApiError } from '../../api/errors'
import { flushQueue } from '../flush'
import {
  clearQueue,
  enqueueWrite,
  listQueued,
  listDeadLettered
} from '../queue'

type PostFn = MiningApi['post']

function apiError(status: number): ApiError {
  return new ApiError(`HTTP ${status}`, status, '/x', null)
}

/** Build a flush apiClient whose `post` runs `impl`, typed as the generic post. */
function clientPosting(impl: (path: string, body: unknown) => Promise<unknown>) {
  const post = vi.fn(impl) as unknown as PostFn
  return { client: { post }, spy: post as unknown as ReturnType<typeof vi.fn> }
}

describe('flushQueue — offline field-capture must never be silently deleted', () => {
  beforeEach(async () => {
    store.clear()
    await clearQueue()
  })

  it('does NOT delete a queued record when the sink route returns 404', async () => {
    await enqueueWrite('ppe_receipt', { ppeKind: 'boots', quantity: 1 })

    const { client, spy } = clientPosting(async () => {
      throw apiError(404)
    })
    const result = await flushQueue(client)

    expect(spy).toHaveBeenCalledTimes(1)
    // The record is STILL in the queue (retryable), not dropped.
    const remaining = await listQueued()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.entityType).toBe('ppe_receipt')
    expect(remaining[0]?.attempts).toBe(1)
    expect(result.remaining).toBe(1)
    // And it has NOT been quarantined on a single 404 either.
    expect(await listDeadLettered()).toHaveLength(0)
  })

  it('retries (does not delete) on 5xx and network errors', async () => {
    await enqueueWrite('fingerprint_sign', { signedFor: 'attendance' })
    await enqueueWrite('photo_upload', { uri: 'https://x/y.jpg' })

    const statuses = [500, 0]
    let i = 0
    const { client } = clientPosting(async () => {
      throw apiError(statuses[i++] ?? 500)
    })
    await flushQueue(client)

    const remaining = await listQueued()
    expect(remaining).toHaveLength(2)
    expect(await listDeadLettered()).toHaveLength(0)
  })

  it('DROPS a record on a genuine payload rejection (400/409/422)', async () => {
    await enqueueWrite('excavator_count', { bad: true })

    const { client } = clientPosting(async () => {
      throw apiError(422)
    })
    await flushQueue(client)

    expect(await listQueued()).toHaveLength(0)
    // A genuine rejection is not field-evidence loss — not dead-lettered.
    expect(await listDeadLettered()).toHaveLength(0)
  })

  it('quarantines (never deletes) a record once the retry budget is exhausted', async () => {
    await enqueueWrite('driver_letter_ack', { letterId: 'L1' })

    const { client } = clientPosting(async () => {
      throw apiError(404)
    })
    // MAX_ATTEMPTS is 5 — flush repeatedly until the budget is exhausted.
    for (let i = 0; i < 5; i += 1) {
      await flushQueue(client)
    }

    // The live queue no longer holds it, but it is preserved in the
    // dead-letter store — NOT silently deleted.
    expect(await listQueued()).toHaveLength(0)
    const dead = await listDeadLettered()
    expect(dead).toHaveLength(1)
    expect(dead[0]?.entityType).toBe('driver_letter_ack')
    expect(dead[0]?.reason).toContain('404')
  })

  it('maps the W-M-10 offline inventory_move shape onto MovementSchema (no 400-drop)', async () => {
    // The EXACT payload W-M-10.tsx enqueues on an offline issue/return.
    await enqueueWrite('inventory_move', {
      warehouseItemId: 'sku-123',
      movementType: 'issue',
      quantityDelta: -4,
      reason: 'Site B headlamp draw'
    })
    await enqueueWrite('inventory_move', {
      warehouseItemId: 'sku-456',
      movementType: 'return',
      quantityDelta: 2,
      reason: 'Unused PPE returned'
    })

    const bodies: Array<Record<string, unknown>> = []
    const { client } = clientPosting(async (_path, body) => {
      bodies.push(body as Record<string, unknown>)
      return { success: true }
    })
    const result = await flushQueue(client)

    // Both synced — neither was dropped as a malformed body.
    expect(result.succeeded).toBe(2)
    expect(await listQueued()).toHaveLength(0)

    // The issue maps to { type:'issue', skuId, fromLocationId, positive quantity }.
    const issue = bodies.find((b) => b.type === 'issue')
    expect(issue).toMatchObject({
      type: 'issue',
      skuId: 'sku-123',
      fromLocationId: 'default-store',
      quantity: 4,
      reference: 'Site B headlamp draw'
    })
    // The return maps to a receipt: { type:'receipt', skuId, locationId, quantity }.
    const receipt = bodies.find((b) => b.type === 'receipt')
    expect(receipt).toMatchObject({
      type: 'receipt',
      skuId: 'sku-456',
      locationId: 'default-store',
      quantity: 2,
      reference: 'Unused PPE returned'
    })
  })

  it('removes a record only on a real 2xx success', async () => {
    await enqueueWrite('ppe_receipt', { ppeKind: 'helmet' })

    const { client, spy } = clientPosting(async () => ({ success: true }))
    const result = await flushQueue(client)

    expect(result.succeeded).toBe(1)
    expect(await listQueued()).toHaveLength(0)
    expect(await listDeadLettered()).toHaveLength(0)
    // The flush sends the queue entry's stable id as the idempotency key.
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String)
        })
      })
    )
  })
})
