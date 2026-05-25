import { chatApi } from '../api/client'
import { getAuthToken } from '../api/session'
import { SseParser } from './streamParser'
import type { ChatMessage, ChatStreamEvent } from './types'

export interface StreamRequest {
  history: ReadonlyArray<Pick<ChatMessage, 'role' | 'content'>>
  signal?: AbortSignal
  onEvent: (event: ChatStreamEvent) => void
}

/**
 * POST chat history to the gateway and consume SSE chunks from the response
 * body. React Native fetch returns a Response with a body that can be read
 * via .text() but not .getReader() reliably across platforms — we feed the
 * whole text into the SseParser at end-of-stream as a fallback. If the
 * runtime exposes a getReader() (web / newer hermes), we stream chunk-wise.
 */
export async function streamChat({
  history,
  signal,
  onEvent
}: StreamRequest): Promise<void> {
  const token = await getAuthToken()
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  })
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  let response: Response
  try {
    response = await fetch(chatApi.url(''), {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages: history }),
      signal
    })
  } catch (error) {
    onEvent({
      type: 'error',
      error: error instanceof Error ? error.message : 'network_error'
    })
    return
  }
  if (!response.ok) {
    onEvent({
      type: 'error',
      error: `http_${response.status}`
    })
    return
  }
  const parser = new SseParser()
  const reader = response.body && 'getReader' in response.body
    ? (response.body as ReadableStream<Uint8Array>).getReader()
    : null
  if (reader) {
    const decoder = new TextDecoder('utf-8')
    try {
      while (!signal?.aborted) {
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }
        const text = decoder.decode(chunk.value, { stream: true })
        for (const event of parser.feed(text)) {
          onEvent(event)
        }
      }
      for (const event of parser.flush()) {
        onEvent(event)
      }
    } catch (error) {
      onEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'stream_error'
      })
      return
    }
  } else {
    // Fallback: read entire body then parse. Loses incremental UX but stays
    // correct on platforms without ReadableStream.
    try {
      const text = await response.text()
      for (const event of parser.feed(text)) {
        onEvent(event)
      }
      for (const event of parser.flush()) {
        onEvent(event)
      }
    } catch (error) {
      onEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'read_error'
      })
      return
    }
  }
  onEvent({ type: 'done' })
}
