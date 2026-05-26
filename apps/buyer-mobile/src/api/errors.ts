export class ApiError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly url: string

  constructor(args: { status: number; code: string; message: string; url: string }) {
    super(args.message)
    this.name = 'ApiError'
    this.status = args.status
    this.code = args.code
    this.url = args.url
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.code === 'NETWORK_ERROR')
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/**
 * The gateway responds to a bid attempt by a non-KYC'd user with
 * 403 { error: { code: 'kyc_required' }, kyc_url: '...' }. Buyers must
 * be redirected to that URL (/kyc) before they can bid.
 */
export function isKycRequiredError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && error.status === 403 && error.code === 'kyc_required'
  )
}
