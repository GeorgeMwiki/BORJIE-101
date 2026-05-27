import type { ChatTurn, ToolCall } from './types'

// Pure history reducers for the chat surface. Kept in their own module so
// they can be unit-tested without pulling react-native (Flow syntax breaks
// Vitest's Rollup parser). HomeChat re-exports thin wrappers.

export interface SettleResponse {
  readonly threadId: string
  readonly responseText: string
  readonly toolCalls?: readonly ToolCall[]
}

export function settle(
  prev: readonly ChatTurn[],
  userText: string,
  response: SettleResponse
): readonly ChatTurn[] {
  return [
    ...prev.map((turn) =>
      turn.pending && turn.role === 'user' && turn.text === userText
        ? { ...turn, pending: false }
        : turn
    ),
    {
      id: `brain-${response.threadId}-${prev.length}`,
      role: 'brain' as const,
      text: response.responseText,
      threadId: response.threadId,
      toolCalls: response.toolCalls ?? [],
      createdAt: new Date().toISOString()
    }
  ]
}

export function fail(
  prev: readonly ChatTurn[],
  userText: string,
  message: string
): readonly ChatTurn[] {
  return [
    ...prev.map((turn) =>
      turn.pending && turn.role === 'user' && turn.text === userText
        ? { ...turn, pending: false, error: message }
        : turn
    ),
    {
      id: `system-${Date.now()}-${prev.length}`,
      role: 'system' as const,
      text: message,
      createdAt: new Date().toISOString()
    }
  ]
}
