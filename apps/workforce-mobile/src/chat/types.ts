import { z } from 'zod'

export type ChatRole = 'user' | 'assistant'

export interface EvidenceChip {
  id: string
  label: string
  url?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  evidence: ReadonlyArray<EvidenceChip>
  createdAt: number
  streaming: boolean
}

export interface ChatStreamEvent {
  type: 'delta' | 'evidence' | 'done' | 'error'
  delta?: string
  evidence?: ReadonlyArray<EvidenceChip>
  error?: string
}

// ───────────────────────────────────────────────────────────────────────
// HomeChat surface — non-streaming, tool-call-rendering chat used by the
// (tabs)/home.tsx pivot. Wire format mirrors POST /api/v1/brain/turn.
// Distinct from the streaming SSE shapes above (ChatMessage / EvidenceChip)
// which power the legacy Ask-Borjie surface.
// ───────────────────────────────────────────────────────────────────────

export const ToolCallResultSchema = z.object({
  tool: z.string().min(1),
  ok: z.boolean(),
  // The api-gateway forwards `turn.toolCalls` verbatim. Today the wire
  // shape carries only `{ tool, ok }`. We accept any extra `result` field
  // (the orchestrator may attach it post-MVP) so the renderer can show
  // it inline. Anything else is preserved as-is.
  result: z.unknown().optional()
})

export type ToolCallResult = z.infer<typeof ToolCallResultSchema>

export const ProposedActionSchema = z.object({
  verb: z.string(),
  object: z.string(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  reviewRequired: z.boolean()
})

export type ProposedAction = z.infer<typeof ProposedActionSchema>

export const BrainTurnResponseSchema = z.object({
  threadId: z.string().min(1),
  responseText: z.string(),
  finalPersonaId: z.string().optional(),
  toolCalls: z.array(ToolCallResultSchema).default([]),
  advisorConsulted: z.boolean().optional(),
  proposedAction: ProposedActionSchema.optional(),
  tokensUsed: z.number().optional()
})

export type BrainTurnResponse = z.infer<typeof BrainTurnResponseSchema>

/**
 * Citation chip emitted at the bottom of an assistant bubble.
 * Per R7 §5.5 (Perplexity anchor pattern) the chip row sits at the
 * BOTTOM of the bubble — mining workers want the answer first, source
 * second. Optional `url` lets the chip open a corpus modal sheet.
 */
export interface Citation {
  readonly id: string
  readonly label: string
  readonly url?: string
}

/** One round-trip in the home chat: user text + assistant reply + tool cards. */
export interface ChatTurn {
  readonly id: string
  readonly userText: string
  readonly responseText: string
  readonly toolCalls: ReadonlyArray<ToolCallResult>
  readonly proposedAction: ProposedAction | null
  readonly citations?: ReadonlyArray<Citation>
  readonly createdAtMs: number
}
