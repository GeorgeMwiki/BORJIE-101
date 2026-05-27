import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * HomeChat tests — focused on the data contract + routing tables that
 * power the chat-first home tab. The workforce-mobile vitest config
 * runs in node (no React Native renderer, no JSX runtime), so each
 * test exercises the layer that is testable cold:
 *
 *   - tool-name → card routing table (TOOL_CARD_ROUTING)
 *   - persona-aware opener map (greetings + suggestion chips)
 *   - i18n labels (HOME_CHAT_LABELS, pickLabel)
 *   - postBrainTurn fetch surface (success + auth-missing + non-OK)
 *   - BrainTurnResponse zod schema (success + reject malformed)
 *   - access table — `home-chat` admits all three roles
 *
 * Render-level behaviour (composer wiring, tap-to-send) is covered by
 * the Playwright E2E pack that runs against the Expo dev server.
 */

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } }
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined)
  }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}))

// Mock the session module once. Individual tests override the spy's
// next return via `getAuthTokenMock.mockResolvedValueOnce(...)` so each
// path can simulate authed / unauthed / token-expired in isolation
// without dynamic-import gymnastics.
const { getAuthTokenMock } = vi.hoisted(() => ({
  getAuthTokenMock: vi.fn<() => Promise<string | null>>(async () => 'jwt-test-token')
}))
vi.mock('../auth/session', () => ({
  getAuthToken: getAuthTokenMock,
  setAuthToken: vi.fn(),
  getCachedAuthToken: vi.fn(() => null)
}))

import {
  TOOL_CARD_ROUTING,
  isKnownTool,
  type ToolName
} from '../chat/toolCardRouting'
import { API_BASE_URL } from '../api/config'
import {
  HOME_CHAT_OPENERS,
  HOME_CHAT_LABELS,
  openerFor,
  pickLabel
} from '../chat/homeChatCopy'
import { BrainTurnResponseSchema } from '../chat/types'
import { postBrainTurn } from '../chat/brainTurn'
import { ApiError } from '../api/errors'
import { canSee } from '../roles/access'

const ALL_TOOLS: ReadonlyArray<ToolName> = [
  'cockpit.daily-brief',
  'cockpit.decisions',
  'cockpit.production',
  'attendance.crew',
  'incidents.exceptions',
  'tasks.today',
  'attendance.shift',
  'performance.snapshot'
]

describe('HomeChat — tool-call routing table', () => {
  it('routes every documented brain tool name to a bilingual label', () => {
    for (const tool of ALL_TOOLS) {
      const entry = TOOL_CARD_ROUTING[tool]
      expect(entry).toBeDefined()
      expect(entry.sw.length).toBeGreaterThan(0)
      expect(entry.en.length).toBeGreaterThan(0)
    }
  })

  it('covers all 8 mappings agreed with the brain — owner 3 + manager 2 + employee 3', () => {
    const keys = Object.keys(TOOL_CARD_ROUTING).sort()
    expect(keys).toEqual([...ALL_TOOLS].sort())
    expect(keys).toHaveLength(8)
  })

  it('isKnownTool guards against unrecognised tool names so the fallback Code block renders', () => {
    expect(isKnownTool('cockpit.daily-brief')).toBe(true)
    expect(isKnownTool('attendance.crew')).toBe(true)
    expect(isKnownTool('mystery.future.tool')).toBe(false)
    expect(isKnownTool('')).toBe(false)
  })
})

describe('HomeChat — persona-aware greeting + suggestions', () => {
  it('returns a Swahili-first greeting for each role', () => {
    expect(openerFor('owner').greetingSw).toBe(
      'Karibu, Bwana Mkubwa. Niambie kuhusu mgodi wako leo.'
    )
    expect(openerFor('manager').greetingSw).toBe(
      'Karibu, Meneja. Tukasaidia timu yako leo.'
    )
    expect(openerFor('employee').greetingSw).toBe(
      'Karibu, Mfanyakazi. Nina kazi gani leo?'
    )
  })

  it('exposes exactly three suggestion chips per role per spec', () => {
    expect(openerFor('owner').suggestions).toHaveLength(3)
    expect(openerFor('manager').suggestions).toHaveLength(3)
    expect(openerFor('employee').suggestions).toHaveLength(3)
  })

  it('uses the documented Swahili suggestion phrases per role', () => {
    const ownerLabels = openerFor('owner').suggestions.map((c) => c.sw)
    expect(ownerLabels).toEqual([
      'Onyesha muhtasari',
      'Hela na muda',
      'Maamuzi yanayosubiri'
    ])
    const managerLabels = openerFor('manager').suggestions.map((c) => c.sw)
    expect(managerLabels).toEqual([
      'Hali ya timu',
      'Mizigo iliyochelewa',
      'Idhinisho zinazosubiri'
    ])
    const employeeLabels = openerFor('employee').suggestions.map((c) => c.sw)
    expect(employeeLabels).toEqual([
      'Shifti yangu leo',
      'Kazi zangu',
      'Ripoti ya mwisho'
    ])
  })

  it('keeps the openers map frozen so it cannot drift at runtime', () => {
    expect(Object.isFrozen(HOME_CHAT_OPENERS)).toBe(true)
    expect(Object.isFrozen(HOME_CHAT_OPENERS.owner)).toBe(true)
    expect(Object.isFrozen(HOME_CHAT_OPENERS.owner.suggestions)).toBe(true)
  })
})

describe('HomeChat — bilingual labels (HOME_CHAT_LABELS)', () => {
  it('picks Swahili by default and English on demand', () => {
    expect(pickLabel('send', 'sw')).toBe('Tuma')
    expect(pickLabel('send', 'en')).toBe('Send')
    expect(pickLabel('thinking', 'sw')).toBe('Borjie anafikiri…')
    expect(pickLabel('thinking', 'en')).toBe('Borjie is thinking…')
  })

  it('exposes the error-retry copy used by the PreviewBanner fallback', () => {
    expect(HOME_CHAT_LABELS.errorRetry.sw).toMatch(/Hatukuweza kufikia ubongo/u)
    expect(HOME_CHAT_LABELS.errorRetry.en).toMatch(/Could not reach the brain/u)
  })
})

describe('HomeChat — BrainTurnResponse schema (zod)', () => {
  it('accepts the minimum payload the brain ever emits (threadId + responseText)', () => {
    const minimum = BrainTurnResponseSchema.safeParse({
      threadId: 'thread-1',
      responseText: 'Habari, mgodi unaendelea vizuri.'
    })
    expect(minimum.success).toBe(true)
    if (minimum.success) {
      expect(minimum.data.toolCalls).toEqual([])
    }
  })

  it('accepts a full payload with tool calls + proposed action', () => {
    const full = BrainTurnResponseSchema.safeParse({
      threadId: 'thread-9',
      responseText: 'Hii ndio brief ya leo',
      finalPersonaId: 'T1_owner_strategist',
      toolCalls: [
        { tool: 'cockpit.daily-brief', ok: true },
        { tool: 'cockpit.decisions', ok: true }
      ],
      advisorConsulted: true,
      proposedAction: {
        verb: 'review',
        object: 'incident:safety',
        riskLevel: 'HIGH',
        reviewRequired: true
      },
      tokensUsed: 1432
    })
    expect(full.success).toBe(true)
    if (full.success) {
      expect(full.data.toolCalls).toHaveLength(2)
      expect(full.data.proposedAction?.riskLevel).toBe('HIGH')
    }
  })

  it('rejects a payload missing threadId', () => {
    const bad = BrainTurnResponseSchema.safeParse({
      responseText: 'No thread id here'
    })
    expect(bad.success).toBe(false)
  })

  it('rejects a tool call missing the `ok` flag', () => {
    const bad = BrainTurnResponseSchema.safeParse({
      threadId: 'thread-2',
      responseText: 'x',
      toolCalls: [{ tool: 'cockpit.production' }]
    })
    expect(bad.success).toBe(false)
  })
})

describe('postBrainTurn — wire contract', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Default: every test gets an authed session. Individual tests can
    // override via `mockResolvedValueOnce(null)` to simulate signed-out.
    getAuthTokenMock.mockReset()
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('attaches Bearer token + JSON body and parses the response', async () => {
    const captured: { url?: string; init?: RequestInit } = {}
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(url)
      if (init !== undefined) {
        captured.init = init
      }
      return new Response(
        JSON.stringify({
          threadId: 'thread-99',
          responseText: 'Habari',
          toolCalls: [{ tool: 'tasks.today', ok: true }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const result = await postBrainTurn({
      userText: 'Kazi zangu leo',
      threadId: null,
      persona: 'T4_field_employee'
    })

    expect(result.threadId).toBe('thread-99')
    expect(result.toolCalls).toHaveLength(1)
    expect(captured.url).toBe(`${API_BASE_URL}/api/v1/brain/turn`)
    const headers = captured.init?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer jwt-test-token')
    const body = JSON.parse(String(captured.init?.body)) as Record<string, unknown>
    expect(body['userText']).toBe('Kazi zangu leo')
    expect(body['forcePersonaId']).toBe('T4_field_employee')
    expect(body['threadId']).toBeUndefined()
  })

  it('throws ApiError(401) when no auth token is cached', async () => {
    getAuthTokenMock.mockResolvedValueOnce(null)
    globalThis.fetch = vi.fn(async () =>
      new Response('{}', { status: 200 })
    ) as unknown as typeof fetch
    await expect(
      postBrainTurn({ userText: 'hi', threadId: null })
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401
    })
  })

  it('throws ApiError(>=400) when the gateway responds non-2xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('rate_limited', { status: 429 })
    ) as unknown as typeof fetch

    let caught: unknown
    try {
      await postBrainTurn({ userText: 'hi', threadId: null })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(429)
  })

  it('includes threadId in the body when continuing an existing thread', async () => {
    let capturedBody = ''
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body)
      return new Response(
        JSON.stringify({ threadId: 'thread-7', responseText: 'ok' }),
        { status: 200 }
      )
    }) as unknown as typeof fetch

    await postBrainTurn({ userText: 'follow-up', threadId: 'thread-7' })
    const body = JSON.parse(capturedBody) as Record<string, unknown>
    expect(body['threadId']).toBe('thread-7')
    expect(body['userText']).toBe('follow-up')
  })
})

describe('HomeChat — RoleGuard access', () => {
  it('admits all three roles to the home-chat surface', () => {
    expect(canSee('home-chat', 'owner')).toBe(true)
    expect(canSee('home-chat', 'manager')).toBe(true)
    expect(canSee('home-chat', 'employee')).toBe(true)
  })
})
