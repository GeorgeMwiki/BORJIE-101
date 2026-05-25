import { apiConfig } from './config'
import { ApiError } from './errors'
import { getAuthToken } from '@/auth/token'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  readonly method?: HttpMethod
  readonly body?: unknown
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>
  readonly signal?: AbortSignal
  readonly headers?: Readonly<Record<string, string>>
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) {
    return ''
  }
  const parts: string[] = []
  for (const key of Object.keys(query).sort()) {
    const value = query[key]
    if (value === undefined) {
      continue
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

async function parseError(response: Response, url: string): Promise<ApiError> {
  const contentType = response.headers.get('content-type') ?? ''
  let message = `Request failed with status ${response.status}`
  let code = `HTTP_${response.status}`
  try {
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        readonly error?: { readonly code?: string; readonly message?: string }
        readonly message?: string
        readonly code?: string
      }
      const envelope = payload.error ?? payload
      if (envelope?.message) {
        message = envelope.message
      }
      if (envelope?.code) {
        code = envelope.code
      }
    } else {
      const text = await response.text()
      if (text) {
        message = text
      }
    }
  } catch {
    // ignore — fall back to default message
  }
  return new ApiError({ status: response.status, code, message, url })
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${apiConfig.baseUrl}${path}${buildQuery(options.query)}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {})
  }
  if (options.body !== undefined && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json'
  }
  const token = await getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), apiConfig.timeoutMs)
  const signal = options.signal ?? ac.signal

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal
  }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(url, init)
  } catch (err) {
    clearTimeout(timer)
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Network error',
      url
    })
  }
  clearTimeout(timer)

  if (!response.ok) {
    throw await parseError(response, url)
  }
  if (response.status === 204) {
    return undefined as unknown as T
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return (await response.json()) as T
  }
  return (await response.text()) as unknown as T
}
