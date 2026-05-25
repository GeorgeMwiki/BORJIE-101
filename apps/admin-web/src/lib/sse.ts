/**
 * Minimal SSE parser for `fetch()`-backed streams.
 *
 * Native `EventSource` cannot POST a body, so the intelligence transport
 * uses `fetch()` + `ReadableStream`. This parser buffers chunks and
 * yields `{ event, data }` pairs as `event: X\ndata: Y\n\n` blocks are
 * completed. Multi-line `data:` fields are joined with '\n' per the
 * SSE spec.
 *
 * Immutability: the parser returns NEW event objects on each call;
 * the internal buffer is reassigned, never mutated-through-reference.
 */

export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

interface ParseStep {
  readonly events: ReadonlyArray<SseEvent>;
  readonly remainder: string;
}

/**
 * Consume a buffer, return all fully-terminated events plus the
 * remainder (partial next event). Buffer is an `\n\n`-delimited set
 * of "event: X\ndata: Y..." blocks.
 */
export function parseSseBuffer(buffer: string): ParseStep {
  const events: SseEvent[] = [];
  let work = buffer;

  for (;;) {
    const sep = work.indexOf('\n\n');
    if (sep === -1) break;
    const raw = work.slice(0, sep);
    work = work.slice(sep + 2);

    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      // ignore id: / retry: for this surface
    }

    if (dataLines.length > 0 || eventName !== 'message') {
      events.push({ event: eventName, data: dataLines.join('\n') });
    }
  }

  return { events, remainder: work };
}

/**
 * Read an SSE response body to completion, dispatching each event to
 * the supplied handler. Returns when the stream ends or `signal`
 * aborts. Errors propagate to the caller.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const step = parseSseBuffer(buffer);
      buffer = step.remainder;
      for (const event of step.events) {
        onEvent(event);
      }
    }
    // flush any trailing event
    buffer += decoder.decode();
    const final = parseSseBuffer(buffer + '\n\n');
    for (const event of final.events) {
      onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}
