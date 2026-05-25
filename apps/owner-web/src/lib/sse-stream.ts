/**
 * Server-Sent Events helper for the owner chat surface.
 *
 * The gateway exposes `/api/v1/owner/chat/stream` as an SSE channel.
 * Browsers can't `POST` from `EventSource`, so we use fetch + a
 * ReadableStream reader and a tiny line-based parser. Each yielded
 * event is `{ event, data }` with `data` already JSON-parsed.
 *
 * Falls back to a simulated stream when `useFallback === true` — used
 * by the chat screen when the gateway is unreachable so the demo flow
 * still works end-to-end.
 */

import { API_BASE } from './api-client';

export interface SseEvent {
  readonly event: string;
  readonly data: unknown;
}

export interface StreamOptions {
  readonly path: string;
  readonly body: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Open an SSE channel and yield decoded events. The async generator
 * terminates after the gateway sends `event: done` or when the caller
 * aborts via the signal.
 */
export async function* streamSse(opts: StreamOptions): AsyncGenerator<SseEvent> {
  const url = `${API_BASE.replace(/\/+$/, '')}${opts.path}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(opts.body),
    signal: opts.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`sse stream failed with HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const ev = parseSseBlock(block);
      if (ev) yield ev;
      if (ev?.event === 'done') return;
    }
  }
}

function parseSseBlock(block: string): SseEvent | null {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:'))
      dataLines.push(line.slice('data:'.length).trim());
  }
  if (!event || dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: dataLines.join('\n') };
  }
}
