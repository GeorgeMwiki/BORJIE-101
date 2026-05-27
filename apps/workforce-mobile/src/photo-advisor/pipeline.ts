import { API_BASE_URL, MINING_PREFIX, DEFAULT_TIMEOUT_MS } from '../api/config'
import { getAuthToken } from '../auth/session'
import {
  PhotoAdvisorRequestSchema,
  PhotoAdvisorResponseSchema,
  type AnalyzePhotoArgs,
  type PhotoAdvisorError,
  type PhotoAdvisorResponse
} from './types'

/**
 * Brain vision endpoint contract — see types.ts for the full spec. Kept
 * as a constant so the empty-state UI and the live network call agree on
 * exactly one path. If/when the gateway ships a different path, change
 * this constant only.
 */
export const VISION_TURN_PATH = '/brain/vision-turn'

function asError(code: PhotoAdvisorError['code'], message: string, details?: Readonly<Record<string, unknown>>): PhotoAdvisorError {
  return { code, message, ...(details ? { details } : {}) }
}

interface FetchAdapter {
  fetch: typeof fetch
}

const DEFAULT_ADAPTER: FetchAdapter = { fetch: globalThis.fetch.bind(globalThis) }

/**
 * Send the captured image + prompt + GPS coords to the api-gateway and
 * decode the structured response. Returns the parsed `PhotoAdvisorResponse`
 * on success.
 *
 * Throws a structured `PhotoAdvisorError` (NOT a plain `Error`) so the UI
 * can switch on `code` without parsing strings. Codes:
 *   - BACKEND_VISION_UNAVAILABLE — gateway returned 404/501/503 for the
 *     vision endpoint (the contract has not been wired yet).
 *   - UNAUTHENTICATED            — 401/403, user must sign back in.
 *   - MALFORMED_RESPONSE         — 2xx with body that fails zod parse.
 *   - NETWORK                    — fetch threw, timed out, or offline.
 *   - UNKNOWN                    — any other non-2xx status.
 */
export async function analyzePhoto(
  args: AnalyzePhotoArgs,
  adapter: FetchAdapter = DEFAULT_ADAPTER
): Promise<PhotoAdvisorResponse> {
  const request = PhotoAdvisorRequestSchema.parse({
    image: {
      uri: args.uri,
      base64: args.base64,
      mimeType: args.mimeType ?? 'image/jpeg',
      width: args.width,
      height: args.height,
      capturedAt: Date.now()
    },
    prompt: args.prompt && args.prompt.trim().length > 0 ? args.prompt : null,
    location: args.location,
    lang: args.lang
  })

  const token = await getAuthToken()
  if (!token) {
    throw asError('UNAUTHENTICATED', 'missing_auth_token')
  }

  const url = `${API_BASE_URL}${MINING_PREFIX}${VISION_TURN_PATH}`
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, DEFAULT_TIMEOUT_MS)

  let response: Response
  try {
    response = await adapter.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(request),
      signal: controller.signal
    })
  } catch (cause) {
    clearTimeout(timer)
    const message = cause instanceof Error ? cause.message : 'network_failure'
    throw asError('NETWORK', message)
  }
  clearTimeout(timer)

  if (response.status === 401 || response.status === 403) {
    throw asError('UNAUTHENTICATED', `auth_failed_${response.status}`)
  }

  if (response.status === 404 || response.status === 501 || response.status === 503) {
    throw asError(
      'BACKEND_VISION_UNAVAILABLE',
      `vision_endpoint_not_wired_${response.status}`,
      { path: `${MINING_PREFIX}${VISION_TURN_PATH}` }
    )
  }

  if (!response.ok) {
    throw asError('UNKNOWN', `gateway_returned_${response.status}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'parse_failure'
    throw asError('MALFORMED_RESPONSE', message)
  }

  const parsed = PhotoAdvisorResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw asError('MALFORMED_RESPONSE', parsed.error.message)
  }
  return parsed.data
}
