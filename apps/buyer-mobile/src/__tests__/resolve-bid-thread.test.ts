/**
 * Regression test — contract-422 finding (3): the buyer chat screen's legacy
 * bid composer POSTed /api/v1/mining/bids/:id/messages, a route that never
 * existed on the gateway → Send always 404'd. The screen now resolves the
 * bid's `threadResponseId` and delegates to the canonical thread surface, or
 * shows an honest empty-state when no thread exists.
 *
 * These tests pin the pure resolution the screen uses (pickActiveBidId +
 * resolveBidThread) so the dead-route behaviour can never silently return.
 */

import { describe, it, expect } from 'vitest'
import {
  pickActiveBidId,
  resolveBidThread,
  type BidThreadCandidate,
} from '@/marketplace/resolveBidThread'

describe('pickActiveBidId', () => {
  it('prefers an explicit bidId', () => {
    expect(pickActiveBidId('bid_explicit', [{ id: 'bid_other', status: 'pending' }])).toBe(
      'bid_explicit',
    )
  })

  it('falls back to the first pending/countered bid', () => {
    const bids: BidThreadCandidate[] = [
      { id: 'bid_rejected', status: 'rejected' },
      { id: 'bid_live', status: 'countered' },
    ]
    expect(pickActiveBidId(undefined, bids)).toBe('bid_live')
  })

  it('falls back to the first bid of any status when none are live', () => {
    const bids: BidThreadCandidate[] = [{ id: 'bid_a', status: 'rejected' }]
    expect(pickActiveBidId(undefined, bids)).toBe('bid_a')
  })

  it('returns null when there are no bids', () => {
    expect(pickActiveBidId(undefined, [])).toBeNull()
    expect(pickActiveBidId(undefined, undefined)).toBeNull()
  })
})

describe('resolveBidThread', () => {
  it('delegates to the canonical thread when the bid has a threadResponseId', () => {
    const res = resolveBidThread({
      id: 'bid_1',
      status: 'accepted',
      threadResponseId: 'rfbr_123',
    })
    expect(res).toEqual({ kind: 'thread', responseId: 'rfbr_123' })
  })

  it('shows the honest no_thread state for a marketplace bid with no thread', () => {
    expect(resolveBidThread({ id: 'bid_2', status: 'pending', threadResponseId: null })).toEqual({
      kind: 'no_thread',
    })
    expect(resolveBidThread({ id: 'bid_3', status: 'pending' })).toEqual({ kind: 'no_thread' })
  })

  it('treats a blank threadResponseId as no thread (never opens a dead thread)', () => {
    expect(resolveBidThread({ id: 'bid_4', status: 'pending', threadResponseId: '' })).toEqual({
      kind: 'no_thread',
    })
  })

  it('returns empty when there is no active bid', () => {
    expect(resolveBidThread(undefined)).toEqual({ kind: 'empty' })
  })
})
