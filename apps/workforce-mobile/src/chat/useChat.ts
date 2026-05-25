import { useCallback, useRef, useState } from 'react'
import { streamChat } from './streamChat'
import type { ChatMessage, EvidenceChip } from './types'

function newMessageId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export interface ChatState {
  messages: ReadonlyArray<ChatMessage>
  sending: boolean
  error: string | null
}

const INITIAL_STATE: ChatState = {
  messages: [],
  sending: false,
  error: null
}

export interface UseChatResult {
  state: ChatState
  send: (text: string) => Promise<void>
  reset: () => void
  stop: () => void
}

/**
 * Owner Ask Borjie chat state. Streams assistant deltas into the trailing
 * message, attaches evidence chips when they arrive, and tolerates the
 * stream cutting out mid-response.
 */
export function useChat(): UseChatResult {
  const [state, setState] = useState<ChatState>(INITIAL_STATE)
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback((): void => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  const reset = useCallback((): void => {
    stop()
    setState(INITIAL_STATE)
  }, [stop])

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim()
      if (trimmed.length === 0) {
        return
      }
      stop()
      const controller = new AbortController()
      abortRef.current = controller
      const userMessage: ChatMessage = {
        id: newMessageId(),
        role: 'user',
        content: trimmed,
        evidence: [],
        createdAt: Date.now(),
        streaming: false
      }
      const assistantMessage: ChatMessage = {
        id: newMessageId(),
        role: 'assistant',
        content: '',
        evidence: [],
        createdAt: Date.now(),
        streaming: true
      }
      setState((prev) => ({
        messages: [...prev.messages, userMessage, assistantMessage],
        sending: true,
        error: null
      }))
      const history = [
        ...state.messages.map((message) => ({
          role: message.role,
          content: message.content
        })),
        { role: userMessage.role, content: userMessage.content }
      ]
      try {
        await streamChat({
          history,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'delta' && event.delta) {
              setState((prev) => ({
                ...prev,
                messages: appendDelta(prev.messages, assistantMessage.id, event.delta!)
              }))
            } else if (event.type === 'evidence' && event.evidence) {
              setState((prev) => ({
                ...prev,
                messages: setEvidence(prev.messages, assistantMessage.id, event.evidence!)
              }))
            } else if (event.type === 'error') {
              setState((prev) => ({
                ...prev,
                messages: stopStreaming(prev.messages, assistantMessage.id),
                sending: false,
                error: event.error ?? 'error'
              }))
            }
          }
        })
      } finally {
        setState((prev) => ({
          ...prev,
          messages: stopStreaming(prev.messages, assistantMessage.id),
          sending: false
        }))
        abortRef.current = null
      }
    },
    [state.messages, stop]
  )

  return { state, send, reset, stop }
}

function appendDelta(
  messages: ReadonlyArray<ChatMessage>,
  id: string,
  delta: string
): ReadonlyArray<ChatMessage> {
  return messages.map((message) => {
    if (message.id !== id) {
      return message
    }
    return { ...message, content: `${message.content}${delta}` }
  })
}

function setEvidence(
  messages: ReadonlyArray<ChatMessage>,
  id: string,
  evidence: ReadonlyArray<EvidenceChip>
): ReadonlyArray<ChatMessage> {
  return messages.map((message) => {
    if (message.id !== id) {
      return message
    }
    return { ...message, evidence }
  })
}

function stopStreaming(
  messages: ReadonlyArray<ChatMessage>,
  id: string
): ReadonlyArray<ChatMessage> {
  return messages.map((message) => {
    if (message.id !== id) {
      return message
    }
    return { ...message, streaming: false }
  })
}
