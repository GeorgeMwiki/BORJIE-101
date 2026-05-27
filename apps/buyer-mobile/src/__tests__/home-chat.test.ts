import { describe, expect, it } from 'vitest'
import {
  BrainTurnRequestSchema,
  BrainTurnResponseSchema,
  isBuyerToolName,
  type ChatTurn
} from '../chat/types'
import {
  BidRecommendationResultSchema,
  BidsResultSchema,
  DealPipelineResultSchema,
  KycStatusResultSchema,
  MarketplaceListingsResultSchema,
  extractPayload
} from '../chat/toolPayloads'
import {
  buyerGreeting,
  buyerSuggestions,
  composerPlaceholder,
  errorLabel,
  loadingLabel
} from '../chat/greeting'
import { settle, fail } from '../chat/historyReducer'

describe('chat/types — request/response schemas', () => {
  it('rejects empty userText on the request', () => {
    const result = BrainTurnRequestSchema.safeParse({ userText: '' })
    expect(result.success).toBe(false)
  })

  it('accepts a minimal turn request and round-trips threadId', () => {
    const result = BrainTurnRequestSchema.safeParse({
      userText: 'Dhahabu inayouzwa sasa',
      threadId: 'thr-1'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.threadId).toBe('thr-1')
    }
  })

  it('parses a brain response with tool calls', () => {
    const result = BrainTurnResponseSchema.safeParse({
      threadId: 'thr-1',
      responseText: 'Karibu',
      toolCalls: [{ name: 'marketplace.recommended', result: { listings: [] } }]
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.toolCalls?.[0]?.name).toBe('marketplace.recommended')
    }
  })

  it('rejects a brain response that omits responseText', () => {
    const result = BrainTurnResponseSchema.safeParse({ threadId: 'thr-1' })
    expect(result.success).toBe(false)
  })
})

describe('chat/types — buyer tool registry', () => {
  it('classifies known tool names', () => {
    expect(isBuyerToolName('marketplace.recommended')).toBe(true)
    expect(isBuyerToolName('kyc.status')).toBe(true)
    expect(isBuyerToolName('bids.recommend')).toBe(true)
  })

  it('rejects unknown tool names so the renderer falls back to JSON', () => {
    expect(isBuyerToolName('marketplace.unknown')).toBe(false)
    expect(isBuyerToolName('')).toBe(false)
  })
})

describe('chat/toolPayloads — schema gate', () => {
  it('parses marketplace.recommended listings', () => {
    const result = MarketplaceListingsResultSchema.safeParse({
      listings: [
        {
          id: 'L1',
          mineral: 'gold_concentrate',
          title: 'Geita gold',
          grade: '12%',
          quantityKg: 60,
          originRegion: 'Geita',
          seller: { id: 'S1', name: 'Mwana Mining' },
          priceHintTzs: 240_000_000,
          listedAt: '2026-05-20T10:00:00Z',
          status: 'open'
        }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('parses bids.active with optional thread', () => {
    const result = BidsResultSchema.safeParse({
      bids: [
        {
          id: 'B1',
          listingId: 'L1',
          listingTitle: 'Geita gold',
          mineral: 'gold_concentrate',
          offerTzsPerKg: 2_000_000,
          quantityKg: 60,
          status: 'pending',
          placedAt: '2026-05-25T11:00:00Z'
        }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('parses kyc.status, deals.pipeline, and bids.recommend payloads', () => {
    expect(KycStatusResultSchema.safeParse({ status: 'approved' }).success).toBe(true)
    expect(
      DealPipelineResultSchema.safeParse({ negotiating: 2, accepted: 1, closed: 0, total: 3 }).success
    ).toBe(true)
    expect(
      BidRecommendationResultSchema.safeParse({
        listingId: 'L1',
        listingTitle: 'Geita gold',
        recommendedTzsPerKg: 1_900_000,
        quantityKg: 60
      }).success
    ).toBe(true)
  })

  it('extractPayload prefers result over args', () => {
    expect(extractPayload({ args: { a: 1 }, result: { b: 2 } })).toEqual({ b: 2 })
    expect(extractPayload({ args: { a: 1 } })).toEqual({ a: 1 })
    expect(extractPayload({})).toBeUndefined()
  })
})

describe('chat/greeting — bilingual persona surface', () => {
  it('returns Swahili greeting by default and English when requested', () => {
    expect(buyerGreeting('sw')).toMatch(/Karibu, Mnunuzi/)
    expect(buyerGreeting('en')).toMatch(/Welcome, buyer/)
  })

  it('exposes three buyer-intent suggestion chips per language', () => {
    expect(buyerSuggestions('sw').length).toBe(3)
    expect(buyerSuggestions('en').length).toBe(3)
    expect(buyerSuggestions('sw')[0]?.prompt).toBe('Dhahabu inayouzwa sasa')
  })

  it('exposes Swahili loading + error + placeholder copy', () => {
    expect(loadingLabel('sw')).toBe('Borjie anafikiri…')
    expect(errorLabel('sw')).toMatch(/Borjie/)
    expect(composerPlaceholder('sw')).toMatch(/Borjie/)
  })
})

describe('chat/HomeChat — pure settle/fail reducers', () => {
  const pendingUserTurn: ChatTurn = {
    id: 'user-1',
    role: 'user',
    text: 'Bei ya tanzanite leo',
    pending: true,
    createdAt: '2026-05-27T08:00:00Z'
  }

  it('settles the optimistic user turn and appends a brain turn', () => {
    const next = settle([pendingUserTurn], 'Bei ya tanzanite leo', {
      threadId: 'thr-1',
      responseText: 'Bei ya leo ni TZS 1.2M/g',
      toolCalls: [{ name: 'marketplace.lobby', result: { listings: [] } }]
    })
    expect(next.length).toBe(2)
    expect(next[0]?.pending).toBe(false)
    expect(next[1]?.role).toBe('brain')
    expect(next[1]?.threadId).toBe('thr-1')
    expect(next[1]?.toolCalls?.[0]?.name).toBe('marketplace.lobby')
  })

  it('fail() flags the pending turn and appends a system error', () => {
    const next = fail([pendingUserTurn], 'Bei ya tanzanite leo', 'connection lost')
    expect(next.length).toBe(2)
    expect(next[0]?.pending).toBe(false)
    expect(next[0]?.error).toBe('connection lost')
    expect(next[1]?.role).toBe('system')
    expect(next[1]?.text).toBe('connection lost')
  })

  it('settle is immutable — original history is not mutated', () => {
    const original: readonly ChatTurn[] = [pendingUserTurn]
    settle(original, 'Bei ya tanzanite leo', {
      threadId: 'thr-1',
      responseText: 'ok'
    })
    expect(original[0]?.pending).toBe(true)
    expect(original.length).toBe(1)
  })
})
