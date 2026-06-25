/**
 * Typed API error so call sites can switch on status without parsing strings.
 * Network failures (no response) surface as status === 0.
 *
 * `code` carries the gateway error envelope's machine code
 * (`error.code` from `{ success:false, error:{ code, message } }`) when present
 * so call sites can localize via `localizeApiError(err.code, locale)` instead
 * of rendering the raw English `message` off the wire (which under `sw` is
 * language mixing). `message` is retained for logs / dev only.
 */
export class ApiError extends Error {
  public readonly status: number
  public readonly url: string
  public readonly body: unknown
  public readonly code: string | null

  constructor(
    message: string,
    status: number,
    url: string,
    body: unknown,
    code: string | null = null
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.url = url
    this.body = body
    this.code = code
  }
}

/**
 * Lift the gateway error envelope `{ success:false, error:{ code, message } }`
 * from a parsed response body. Returns the machine code + raw message when the
 * shape matches; nulls otherwise. The raw message is for logs only — never
 * render it directly (localize by `code` instead).
 */
export function parseError(body: unknown): {
  readonly code: string | null
  readonly message: string | null
} {
  if (body && typeof body === 'object' && 'error' in body) {
    const env = (body as { error?: unknown }).error
    if (env && typeof env === 'object') {
      const code = (env as { code?: unknown }).code
      const message = (env as { message?: unknown }).message
      return {
        code: typeof code === 'string' ? code : null,
        message: typeof message === 'string' ? message : null,
      }
    }
  }
  return { code: null, message: null }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}
