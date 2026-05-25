import { API_BASE_URL, FIELD_PREFIX, OWNER_PREFIX, CHAT_PREFIX } from './config'
import { ApiError } from './errors'
import { getAuthToken } from './session'

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
 * Core fetch wrapper. Adds JSON headers + bearer token, throws ApiError on
 * non-2xx, returns parsed JSON otherwise. Network failures surface as
 * ApiError with status 0 so call sites can switch on it uniformly.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const url = `${path}${buildQuery(options.query)}`
  const headers = await buildHeaders(options.headers)
  const init: RequestInit = {
    method,
    headers,
    signal: options.signal
  }
  if (options.body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(options.body)
  }
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'Network request failed',
      0,
      url,
      null
    )
  }
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
