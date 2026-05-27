import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the native-only modules pulled in transitively by the pipeline.
// expo-constants imports react-native (Flow syntax — Rollup/vitest cannot
// parse it), and @react-native-async-storage/async-storage is the same
// story. Mocking them here keeps the pipeline pure-Node testable.
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

import { analyzePhoto, VISION_TURN_PATH } from '../pipeline'
import { MINING_PREFIX } from '../../api/config'
import * as session from '../../auth/session'
import type { AnalyzePhotoArgs } from '../types'

function buildArgs(overrides: Partial<AnalyzePhotoArgs> = {}): AnalyzePhotoArgs {
  return {
    uri: 'file:///tmp/photo.jpg',
    base64: 'aGVsbG8td29ybGQ=',
    mimeType: 'image/jpeg',
    width: 1920,
    height: 1080,
    prompt: 'Niambie kuhusu eneo hili',
    location: {
      latitude: -3.4287,
      longitude: 32.9183,
      accuracyMetres: 8,
      capturedAt: 1_700_000_000_000
    },
    lang: 'sw',
    ...overrides
  }
}

function mockFetchOnce(response: { status: number; body?: unknown; throws?: Error }) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response.throws) {
      throw response.throws
    }
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    })
  })
  return { fetchMock, adapter: { fetch: fetchMock as unknown as typeof fetch } }
}

beforeEach(() => {
  vi.spyOn(session, 'getAuthToken').mockResolvedValue('test-token-xyz')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('analyzePhoto — happy path', () => {
  it('posts the captured photo + GPS + prompt and decodes the typed reply', async () => {
    const body = {
      summary: 'Eneo lina dalili za uchimbaji wa wazi.',
      reasoning: 'Picha inaonyesha mashimo mawili na lori la mzigo.',
      suggestions: ['Weka uzio wa usalama', 'Ongeza taa za jioni'],
      citations: [
        {
          evidenceId: 'corpus_TZ_open_pit_001',
          source: 'Tanzania Mining Act 2010, s.42',
          excerpt: 'Open-pit operations must maintain a 30m setback…'
        }
      ]
    }
    const { fetchMock, adapter } = mockFetchOnce({ status: 200, body })

    const result = await analyzePhoto(buildArgs(), adapter)

    expect(result.summary).toBe(body.summary)
    expect(result.suggestions).toHaveLength(2)
    expect(result.citations[0]?.evidenceId).toBe('corpus_TZ_open_pit_001')

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? []
    expect(String(calledUrl)).toContain(`${MINING_PREFIX}${VISION_TURN_PATH}`)
    expect(calledInit?.method).toBe('POST')
    expect((calledInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-token-xyz'
    )
    const parsedBody = JSON.parse((calledInit?.body as string) ?? '{}')
    expect(parsedBody.lang).toBe('sw')
    expect(parsedBody.image.base64).toBe('aGVsbG8td29ybGQ=')
    expect(parsedBody.location.latitude).toBeCloseTo(-3.4287)
  })
})

describe('analyzePhoto — auth failures', () => {
  it('throws UNAUTHENTICATED when no token is present', async () => {
    vi.spyOn(session, 'getAuthToken').mockResolvedValue(null)
    const { fetchMock, adapter } = mockFetchOnce({ status: 200, body: {} })

    await expect(analyzePhoto(buildArgs(), adapter)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws UNAUTHENTICATED on a gateway 401', async () => {
    const { adapter } = mockFetchOnce({ status: 401, body: { error: 'no_auth' } })

    await expect(analyzePhoto(buildArgs(), adapter)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'auth_failed_401'
    })
  })
})

describe('analyzePhoto — backend not yet wired', () => {
  it('surfaces BACKEND_VISION_UNAVAILABLE on a 404 from the gateway', async () => {
    const { adapter } = mockFetchOnce({ status: 404 })

    await expect(analyzePhoto(buildArgs(), adapter)).rejects.toMatchObject({
      code: 'BACKEND_VISION_UNAVAILABLE'
    })
  })

  it('surfaces BACKEND_VISION_UNAVAILABLE on a 503 (capability not configured)', async () => {
    const { adapter } = mockFetchOnce({ status: 503 })

    await expect(analyzePhoto(buildArgs(), adapter)).rejects.toMatchObject({
      code: 'BACKEND_VISION_UNAVAILABLE'
    })
  })
})

describe('analyzePhoto — malformed responses', () => {
  it('throws MALFORMED_RESPONSE when the body does not match the schema', async () => {
    const { adapter } = mockFetchOnce({
      status: 200,
      body: { summary: 'ok' /* missing reasoning, suggestions, citations */ }
    })

    await expect(analyzePhoto(buildArgs(), adapter)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE'
    })
  })
})

describe('analyzePhoto — GPS-denied path', () => {
  it('accepts a null location and still posts a complete request body', async () => {
    const body = {
      summary: 'Picha haina GPS — jibu la jumla.',
      reasoning: 'Bila kuratibu hatuwezi kupendekeza umbali halisi.',
      suggestions: ['Washa GPS na uthibitishe tena'],
      citations: []
    }
    const { fetchMock, adapter } = mockFetchOnce({ status: 200, body })

    const result = await analyzePhoto(buildArgs({ location: null }), adapter)
    expect(result.summary).toBe(body.summary)

    const calledInit = fetchMock.mock.calls[0]?.[1]
    const parsedBody = JSON.parse((calledInit?.body as string) ?? '{}')
    expect(parsedBody.location).toBeNull()
  })
})

describe('analyzePhoto — network failures', () => {
  it('throws NETWORK when fetch rejects', async () => {
    const { adapter } = mockFetchOnce({
      status: 0,
      throws: new Error('offline_no_route')
    })

    await expect(analyzePhoto(buildArgs(), adapter)).rejects.toMatchObject({
      code: 'NETWORK',
      message: 'offline_no_route'
    })
  })
})
