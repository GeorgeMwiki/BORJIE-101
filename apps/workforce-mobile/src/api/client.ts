import {
  API_BASE_URL,
  FIELD_PREFIX,
  OWNER_PREFIX,
  CHAT_PREFIX,
  MINING_PREFIX,
  DEFAULT_TIMEOUT_MS
} from './config'
import { ApiError } from './errors'
import { getAuthToken } from '../auth/session'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  query?: Readonly<Record<string, string | number | boolean | undefined>>
  signal?: AbortSignal
  headers?: Readonly<Record<string, string>>
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) {
    return ''
  }
  const entries: string[] = []
  for (const key of Object.keys(query)) {
    const value = query[key]
    if (value === undefined) {
      continue
    }
    entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return entries.length > 0 ? `?${entries.join('&')}` : ''
}

async function buildHeaders(
  extra?: Readonly<Record<string, string>>
): Promise<Headers> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json'
  })
  const token = await getAuthToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (extra) {
    for (const key of Object.keys(extra)) {
      headers.set(key, extra[key]!)
    }
  }
  return headers
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * Core fetch wrapper. Adds JSON headers + bearer token, enforces a 5s
 * timeout via AbortController (overrideable by passing a caller signal),
 * throws ApiError on non-2xx, returns parsed JSON otherwise. Network
 * failures (including timeouts) surface as ApiError with status 0 so call
 * sites can switch on it uniformly.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const url = `${path}${buildQuery(options.query)}`
  const headers = await buildHeaders(options.headers)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, DEFAULT_TIMEOUT_MS)
  const signal = options.signal ?? controller.signal
  const init: RequestInit = {
    method,
    headers,
    signal
  }
  if (options.body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(options.body)
  }
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (cause) {
    clearTimeout(timer)
    throw new ApiError(
      cause instanceof Error ? cause.message : 'Network request failed',
      0,
      url,
      null
    )
  }
  clearTimeout(timer)
  const body = await parseBody(response)
  if (!response.ok) {
    throw new ApiError(
      `Request to ${path} failed with ${response.status}`,
      response.status,
      url,
      body
    )
  }
  return body as T
}

function fieldUrl(path: string): string {
  return `${API_BASE_URL}${FIELD_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

function ownerUrl(path: string): string {
  return `${API_BASE_URL}${OWNER_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

function chatUrl(path: string): string {
  return `${API_BASE_URL}${CHAT_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

function miningUrl(path: string): string {
  return `${API_BASE_URL}${MINING_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

export const fieldApi = {
  get: <T,>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>(fieldUrl(path), { ...options, method: 'GET' }),
  post: <T,>(path: string, body: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(fieldUrl(path), { ...options, method: 'POST', body })
}

export const ownerApi = {
  get: <T,>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>(ownerUrl(path), { ...options, method: 'GET' }),
  post: <T,>(path: string, body: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(ownerUrl(path), { ...options, method: 'POST', body })
}

export const chatApi = {
  url: (path = ''): string => chatUrl(path),
  post: <T,>(body: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(chatUrl(''), { ...options, method: 'POST', body })
}

/**
 * Canonical client for the api-gateway mining surface. Used by the sync
 * queue flush and any new screens that need to talk to mining endpoints.
 * Prefer this over `fieldApi` / `ownerApi` for new code.
 */
export const miningApi = {
  get: <T,>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>(miningUrl(path), { ...options, method: 'GET' }),
  post: <T,>(path: string, body: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(miningUrl(path), { ...options, method: 'POST', body })
}

export type MiningApi = typeof miningApi
