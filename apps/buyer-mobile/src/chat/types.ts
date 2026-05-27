import { z } from 'zod'

// Validated payloads exchanged with the api-gateway /api/v1/brain/turn
// endpoint. The brain orchestrator returns a flexible `toolCalls` array —
// each entry has a `name` (used to dispatch a buyer-context renderer) plus
// an `args`/`result` envelope. Schemas are intentionally permissive on the
// inside (`unknown` for nested args) and strict at the boundary so the
// renderer can fall through to a generic JSON view for unknown tools.

export const BrainTurnRequestSchema = z.object({
  userText: z.string().min(1, 'userText_required'),
  threadId: z.string().optional(),
  forcePersonaId: z.string().optional()
})

export type BrainTurnRequest = z.infer<typeof BrainTurnRequestSchema>

export const ToolCallSchema = z.object({
  name: z.string(),
  args: z.unknown().optional(),
  result: z.unknown().optional()
})

export type ToolCall = z.infer<typeof ToolCallSchema>

export const BrainTurnResponseSchema = z.object({
  threadId: z.string(),
  finalPersonaId: z.string().optional(),
  responseText: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  handoffs: z.array(z.unknown()).optional(),
  advisorConsulted: z.boolean().optional(),
  tokensUsed: z.number().optional()
})

export type BrainTurnResponse = z.infer<typeof BrainTurnResponseSchema>

// A single rendered exchange in the chat history. `pending` distinguishes
// the optimistic in-flight user turn from a settled brain response; we
// keep both immutable in state so React never re-renders past entries.

export type ChatRole = 'user' | 'brain' | 'system'

export interface ChatTurn {
  readonly id: string
  readonly role: ChatRole
  readonly text: string
  readonly threadId?: string
  readonly toolCalls?: readonly ToolCall[]
  readonly pending?: boolean
  readonly error?: string
  readonly createdAt: string
}

// Buyer-specific tool name registry. Adding a new card means adding a new
// entry here and a new branch in `ToolCallRenderer`. Unknown names fall
// through to the generic JSON code-block view.

export const BUYER_TOOL_NAMES = [
  'marketplace.recommended',
  'marketplace.lobby',
  'bids.active',
  'kyc.status',
  'bids.recommend',
  'deals.pipeline'
] as const

export type BuyerToolName = (typeof BUYER_TOOL_NAMES)[number]

export function isBuyerToolName(value: string): value is BuyerToolName {
  return (BUYER_TOOL_NAMES as readonly string[]).includes(value)
}
