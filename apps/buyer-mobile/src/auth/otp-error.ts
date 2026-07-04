/**
 * Stable, provider-agnostic OTP error CODES for the buyer OTP flow.
 *
 * Supabase surfaces raw English `error.message` strings; rendering one
 * under an `sw` locale is language mixing (the active-locale canon forbids
 * it). The session layer classifies the provider error into one of these
 * CODES and the login screen maps the code to localized copy via `t()` —
 * the raw provider string never reaches user copy (branch internally, show
 * localized copy only).
 */
export type OtpErrorCode =
  | 'otp_invalid'
  | 'rate_limited'
  | 'otp_expired'
  | 'send_failed'
  | 'network'

const OTP_ERROR_CODES: ReadonlySet<string> = new Set<OtpErrorCode>([
  'otp_invalid',
  'rate_limited',
  'otp_expired',
  'send_failed',
  'network',
])

export function isOtpErrorCode(value: unknown): value is OtpErrorCode {
  return typeof value === 'string' && OTP_ERROR_CODES.has(value)
}

/**
 * Classify an unknown provider/transport error into a stable code. Only
 * ever RETURNS a code — never leaks the raw string. Unknown shapes map to
 * the conservative `send_failed`.
 */
export function classifyOtpError(err: unknown): OtpErrorCode {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return classifyOtpMessage(raw)
}

/**
 * Classify a provider error message string (e.g. Supabase `error.message`)
 * into a stable code. Case-insensitive substring matching against known
 * provider phrasings; unknown shapes fall back to `send_failed`.
 */
export function classifyOtpMessage(message: string): OtpErrorCode {
  const text = message.toLowerCase()
  if (text.includes('rate') || text.includes('too many') || text.includes('429')) {
    return 'rate_limited'
  }
  if (text.includes('expired')) {
    return 'otp_expired'
  }
  if (
    text.includes('invalid') ||
    text.includes('incorrect') ||
    text.includes('otp')
  ) {
    return 'otp_invalid'
  }
  if (
    text.includes('network') ||
    text.includes('fetch') ||
    text.includes('timeout') ||
    text.includes('connection')
  ) {
    return 'network'
  }
  return 'send_failed'
}
