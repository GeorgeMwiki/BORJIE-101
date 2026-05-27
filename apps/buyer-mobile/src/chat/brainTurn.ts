import { apiFetch } from '@/api/client'
import {
  BrainTurnRequest,
  BrainTurnRequestSchema,
  BrainTurnResponse,
  BrainTurnResponseSchema
} from './types'

// Single canonical hop between buyer-mobile and the api-gateway brain
// router. The request is validated client-side (so a bad call surfaces a
// developer-friendly zod error instead of an HTTP 400) and the response
// is parsed through the matching zod schema so unexpected upstream shapes
// throw locally instead of crashing a renderer.

const BRAIN_TURN_PATH = '/api/v1/brain/turn'

export async function postBrainTurn(input: BrainTurnRequest): Promise<BrainTurnResponse> {
  const parsedInput = BrainTurnRequestSchema.parse(input)
  const raw = await apiFetch<unknown>(BRAIN_TURN_PATH, {
    method: 'POST',
    body: parsedInput
  })
  const parsed = BrainTurnResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('brain_turn_invalid_response')
  }
  return parsed.data
}
