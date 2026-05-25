import type { ChatStreamEvent, EvidenceChip } from './types'

/**
 * Stateful line-buffered SSE parser. Server emits `data: { ... }` chunks
 * separated by double newlines. We accept a chunk of bytes (already decoded)
 * and emit zero-or-more parsed events.
 */
export class SseParser {
  private buffer: string = ''

  feed(chunk: string): ReadonlyArray<ChatStreamEvent> {
    this.buffer += chunk
    const events: ChatStreamEvent[] = []
    let boundary = this.buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const raw = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const event = parseEvent(raw)
      if (event) {
        events.push(event)
      }
      boundary = this.buffer.indexOf('\n\n')
    }
    return events
  }

  flush(): ReadonlyArray<ChatStreamEvent> {
    if (this.buffer.length === 0) {
      return []
    }
    const event = parseEvent(this.buffer)
    this.buffer = ''
    return event ? [event] : []
  }
}

function parseEvent(raw: string): ChatStreamEvent | null {
  const dataLine = raw
    .split('\n')
    .find((line) => line.startsWith('data:'))
  if (!dataLine) {
    return null
  }
  const payload = dataLine.slice('data:'.length).trim()
  if (payload === '[DONE]') {
    return { type: 'done' }
  }
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    if (typeof parsed['delta'] === 'string') {
      return { type: 'delta', delta: parsed['delta'] }
    }
    if (Array.isArray(parsed['evidence'])) {
      const evidence = (parsed['evidence'] as ReadonlyArray<Record<string, unknown>>)
        .map(toEvidence)
        .filter((chip): chip is EvidenceChip => chip !== null)
      return { type: 'evidence', evidence }
    }
    if (typeof parsed['error'] === 'string') {
      return { type: 'error', error: parsed['error'] }
    }
    return null
  } catch {
    return null
  }
}

function toEvidence(value: Record<string, unknown>): EvidenceChip | null {
  if (typeof value['id'] !== 'string' || typeof value['label'] !== 'string') {
    return null
  }
  const result: EvidenceChip = {
    id: value['id'],
    label: value['label']
  }
  if (typeof value['url'] === 'string') {
    return { ...result, url: value['url'] }
  }
  return result
}
