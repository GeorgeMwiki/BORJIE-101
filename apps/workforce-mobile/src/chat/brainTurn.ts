/**
 * postBrainTurn — single round-trip to POST /api/v1/brain/turn.
 *
 * Pulled out of W-M-16 into a re-usable helper so the HomeChat surface and
 * any future chat-first screen share the same wire path. The endpoint
 * requires a Supabase Bearer token (see `auth/session.ts`); a missing
 * token surfaces as an ApiError with status 401 so callers can route to
 * the role-picker / OTP flow without inspecting strings.
 *
 * Response shape is parsed via zod (BrainTurnResponseSchema) so callers
 * never have to trust the raw payload — any tool-call shape drift surfaces
 * as a parse error that the chat surface renders as a PreviewBanner.
 */

import { API_BASE_URL } from '../api/config'
import { ApiError } from '../api/errors'
import { getAuthToken } from '../auth/session'
import { BrainTurnResponseSchema, type BrainTurnResponse } from './types'

export interface PostBrainTurnArgs {
  readonly userText: string
  readonly threadId: string | null
  /** Optional persona override forwarded to the orchestrator. */
  readonly persona?: string
}

const BRAIN_TURN_PATH = '/api/v1/brain/turn'

export async function postBrainTurn(
  args: PostBrainTurnArgs
): Promise<BrainTurnResponse> {
  const url = `${API_BASE_URL}${BRAIN_TURN_PATH}`
  const token = await getAuthToken()
  if (!token) {
    throw new ApiError('not_authenticated', 401, url, null)
  }
  const body: Record<string, unknown> = {
    userText: args.userText
  }
  if (args.threadId !== null && args.threadId.length > 0) {
    body['threadId'] = args.threadId
  }
  if (args.persona !== undefined && args.persona.length > 0) {
    body['forcePersonaId'] = args.persona
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    })
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'network_error',
      0,
      url,
      null
    )
  }

  const raw = await response.text()
  if (!response.ok) {
    throw new ApiError(
      `brain.turn ${response.status}`,
      response.status,
      url,
      raw.slice(0, 256)
    )
  }

  let parsed: unknown
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : {}
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'parse_error',
      response.status,
      url,
      raw.slice(0, 256)
    )
  }

  const result = BrainTurnResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new ApiError(
      'brain.turn schema mismatch',
      response.status,
      url,
      result.error.issues
    )
  }
  return result.data
}

export const BRAIN_TURN_PATH_FOR_TESTS = BRAIN_TURN_PATH
