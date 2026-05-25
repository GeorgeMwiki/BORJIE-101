/**
 * Typed API error so call sites can switch on status without parsing strings.
 * Network failures (no response) surface as status === 0.
 */
export class ApiError extends Error {
  public readonly status: number
  public readonly url: string
  public readonly body: unknown

  constructor(message: string, status: number, url: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.url = url
    this.body = body
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}
