/**
 * Worker invitation-activation helper.
 *
 * Pure async function called by `app/auth/activate.tsx`. POSTs the
 * (phone, code) pair to the public api-gateway endpoint and returns the
 * Supabase session payload on success.
 *
 * The endpoint is unauthenticated (workers do not have a token yet) so
 * we issue the request without a bearer header — `request()` only
 * attaches the bearer when present, so the call site does not need to
 * thread anything special.
 *
 * Lockout: the SCREEN (activate.tsx) enforces a 3-attempt-per-3-minute
 * window. This helper deliberately stays state-free so it remains pure
 * and trivially testable.
 */

import { API_BASE_URL, MINING_PREFIX as _MINING_PREFIX } from '../api/config'
import { request } from '../api/client'

// `void _MINING_PREFIX` keeps the import warning-free even though we
// route through the dedicated `/api/v1/workforce/invites` prefix below.
void _MINING_PREFIX

const ACTIVATION_PATH = '/api/v1/workforce/invites/activate'

/**
 * E.164 normaliser — strips spaces, trims, ensures leading '+'. Returns
 * the canonical form the api-gateway zod schema expects.
 */
export function normaliseE164(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '')
  if (trimmed.startsWith('+')) {
    return trimmed
  }
  return `+${trimmed.replace(/^0+/, '')}`
}

/**
 * Lightweight client-side validators. The server is the source of
 * truth — this is just to short-circuit a bad submit before a round
 * trip and to render the right error label.
 */
export function isPhoneValid(phone: string): boolean {
  return /^\+[1-9][0-9]{6,14}$/.test(normaliseE164(phone))
}

export function isCodeValid(code: string): boolean {
  return /^[0-9]{6}$/.test(code.trim())
}

export interface ActivationSession {
  readonly accessToken: string | null
  readonly refreshToken: string | null
  readonly expiresIn: number | null
}

export interface ActivationResult {
  readonly invitationId: string
  readonly tenantId: string
  readonly userId: string
  readonly miningRole: 'employee' | 'manager'
  readonly session: ActivationSession
}

export interface ActivationErrorShape {
  readonly code: string
  readonly message: string
}

interface RawActivationResponse {
  readonly success: boolean
  readonly data?: ActivationResult
  readonly error?: ActivationErrorShape
}

/**
 * Activate an invitation. Throws `ApiError` from the underlying client
 * on non-2xx; the caller catches and renders a user-friendly toast.
 */
export async function activateInvitation(input: {
  readonly phoneE164: string
  readonly activationCode: string
}): Promise<ActivationResult> {
  const phoneE164 = normaliseE164(input.phoneE164)
  const activationCode = input.activationCode.trim()
  const url = `${API_BASE_URL}${ACTIVATION_PATH}`
  const response = await request<RawActivationResponse>(url, {
    method: 'POST',
    body: { phoneE164, activationCode }
  })
  if (!response.success || !response.data) {
    const code = response.error?.code ?? 'ACTIVATION_FAILED'
    const message = response.error?.message ?? 'Activation failed'
    throw new ActivationFailedError(code, message)
  }
  return response.data
}

/**
 * Typed error so the screen can branch on the `code` field for i18n
 * without parsing strings.
 */
export class ActivationFailedError extends Error {
  public readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ActivationFailedError'
    this.code = code
  }
}
