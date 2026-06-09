import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ProposedActionCard fulfillment tests — the K2 keystone: a brain-proposed
 * action the worker / owner can now ACT on. The workforce-mobile vitest
 * config runs in node (no RN renderer), so we exercise the cold-testable
 * layer that powers the card:
 *
 *   - buildConfirmRequest — the GENERATIVE { verb, params } derivation
 *     (any verb the card carries, never a per-verb switch)
 *   - interpretResult — the envelope routing, branch-for-branch identical
 *     to owner-web's reflectActionResult
 *   - buildFulfillmentTurn — the structured turn sent to the brain on defer
 *   - confirmAction — the wire contract against the SAME endpoint web uses
 *     (POST /api/v1/owner/chat/confirm-action), incl. the gateway's
 *     { success, data } unwrap + graceful failure envelope
 *
 * Render-level wiring (tap-to-approve → inline note) is covered by the
 * Playwright E2E pack against the Expo dev server.
 */

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}))

const { getAuthTokenMock } = vi.hoisted(() => ({
  getAuthTokenMock: vi.fn<() => Promise<string | null>>(async () => 'jwt-test-token')
}))
vi.mock('../auth/session', () => ({
  getAuthToken: getAuthTokenMock,
  setAuthToken: vi.fn(),
  getCachedAuthToken: vi.fn(() => null)
}))

import { API_BASE_URL } from '../api/config'
import { confirmAction } from '../chat/chatActions'
import {
  buildConfirmRequest,
  buildFulfillmentTurn,
  interpretResult
} from '../chat/actionFulfillment'
import type { ProposedAction } from '../chat/types'

const ACTION: ProposedAction = {
  verb: 'review',
  object: 'incident:safety',
  riskLevel: 'HIGH',
  reviewRequired: true
}

describe('buildConfirmRequest — generative verb/params derivation', () => {
  it('forwards the card verb and object verbatim — no per-verb switch', () => {
    expect(buildConfirmRequest(ACTION)).toEqual({
      verb: 'review',
      params: { object: 'incident:safety' }
    })
  })

  it('works for an arbitrary brain-generated verb the registry never saw', () => {
    const novel: ProposedAction = {
      verb: 'schedule_blast_window',
      object: 'pit:north-7',
      riskLevel: 'MEDIUM',
      reviewRequired: false
    }
    expect(buildConfirmRequest(novel)).toEqual({
      verb: 'schedule_blast_window',
      params: { object: 'pit:north-7' }
    })
  })
})

describe('interpretResult — envelope routing identical to owner-web', () => {
  it('executed → executed outcome carrying the tool result', () => {
    const out = interpretResult(ACTION, {
      executed: true,
      authorized: true,
      deferToBrain: false,
      result: { ticketId: 'INC-9' }
    })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.result).toEqual({ ticketId: 'INC-9' })
    }
  })

  it('deferToBrain → routes to the brain with the echoed verb/params', () => {
    const out = interpretResult(ACTION, {
      executed: false,
      authorized: true,
      deferToBrain: true,
      verb: 'review',
      params: { object: 'incident:safety', priority: 'high' }
    })
    expect(out.kind).toBe('deferToBrain')
    if (out.kind === 'deferToBrain') {
      expect(out.verb).toBe('review')
      expect(out.params).toEqual({ object: 'incident:safety', priority: 'high' })
    }
  })

  it('deferToBrain with no echo falls back to the card verb/params', () => {
    const out = interpretResult(ACTION, {
      executed: false,
      authorized: true,
      deferToBrain: true
    })
    expect(out.kind).toBe('deferToBrain')
    if (out.kind === 'deferToBrain') {
      expect(out.verb).toBe('review')
      expect(out.params).toEqual({ object: 'incident:safety' })
    }
  })

  it('!authorized + reason → needsConfirmation', () => {
    const out = interpretResult(ACTION, {
      executed: false,
      authorized: false,
      deferToBrain: false,
      reason: 'requires four-eyes sign-off'
    })
    expect(out).toEqual({
      kind: 'needsConfirmation',
      reason: 'requires four-eyes sign-off'
    })
  })

  it('bare decline (no reason) → declined without a reason', () => {
    const out = interpretResult(ACTION, {
      executed: false,
      authorized: false,
      deferToBrain: false
    })
    expect(out).toEqual({ kind: 'declined' })
  })

  it('executed wins over deferToBrain when both are set (web parity)', () => {
    const out = interpretResult(ACTION, {
      executed: true,
      authorized: true,
      deferToBrain: true
    })
    expect(out.kind).toBe('executed')
  })
})

describe('buildFulfillmentTurn — structured brain turn on defer', () => {
  it('phrases the verb + object target, Swahili when active', () => {
    expect(
      buildFulfillmentTurn('review', { object: 'incident:safety' }, 'sw')
    ).toBe('Tafadhali kamilisha kitendo: review incident:safety')
  })

  it('phrases the verb + object target, English when active', () => {
    expect(
      buildFulfillmentTurn('review', { object: 'incident:safety' }, 'en')
    ).toBe('Please carry out this action: review incident:safety')
  })

  it('omits the target when no object param is present', () => {
    expect(buildFulfillmentTurn('refresh_brief', {}, 'en')).toBe(
      'Please carry out this action: refresh_brief'
    )
  })
})

describe('confirmAction — wire contract (POST /owner/chat/confirm-action)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    getAuthTokenMock.mockReset()
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('posts { verb, params } with the bearer token and unwraps { success, data }', async () => {
    const captured: { url?: string; init?: RequestInit } = {}
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(url)
      if (init !== undefined) {
        captured.init = init
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: { executed: true, authorized: true, result: { ok: 1 } }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const result = await confirmAction(buildConfirmRequest(ACTION))

    expect(result.executed).toBe(true)
    expect(result.authorized).toBe(true)
    expect(captured.url).toBe(`${API_BASE_URL}/api/v1/owner/chat/confirm-action`)
    const headers = captured.init?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer jwt-test-token')
    const body = JSON.parse(String(captured.init?.body)) as Record<string, unknown>
    expect(body['verb']).toBe('review')
    expect(body['params']).toEqual({ object: 'incident:safety' })
  })

  it('parses a deferToBrain envelope (generative fulfillment)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            executed: false,
            authorized: true,
            deferToBrain: true,
            verb: 'review',
            params: { object: 'incident:safety' }
          }
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch

    const result = await confirmAction(buildConfirmRequest(ACTION))
    expect(result.deferToBrain).toBe(true)
    expect(result.verb).toBe('review')
  })

  it('degrades gracefully to an unauthorized envelope on a non-2xx (never throws)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('forbidden', { status: 403 })
    ) as unknown as typeof fetch

    const result = await confirmAction(buildConfirmRequest(ACTION))
    expect(result.executed).toBe(false)
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/403/u)
  })

  it('degrades gracefully on a network drop (status-0 equivalent)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await confirmAction(buildConfirmRequest(ACTION))
    expect(result.executed).toBe(false)
    expect(result.authorized).toBe(false)
    expect(result.reason).toBe('network down')
  })
})
