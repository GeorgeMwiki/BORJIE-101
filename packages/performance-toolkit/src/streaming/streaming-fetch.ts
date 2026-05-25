/**
 * `streamingFetch` — client-side SSE consumer built on `fetch` +
 * `ReadableStream`. Why not `EventSource`? Two reasons:
 *
 *   1. EventSource is GET-only — we can't POST a prompt body to it.
 *   2. EventSource has no built-in way to send auth headers.
 *
 * Returns the final assembled value (concat of all chunks). Calls
 * `onChunk` on each parsed SSE event for incremental rendering.
 */

export interface StreamingFetchOptions {
  /** Standard fetch RequestInit — usual method/body/headers. */
  readonly init?: RequestInit;
  /** Called for each parsed event. */
  readonly onChunk?: (chunk: string, event: string) => void;
  /** Aborts the stream early. */
  readonly signal?: AbortSignal;
}

export async function streamingFetch(
  url: string,
  opts: StreamingFetchOptions = {},
): Promise<string> {
  const init: RequestInit = {
    ...opts.init,
    headers: {
      Accept: 'text/event-stream',
      ...opts.init?.headers,
    },
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`streamingFetch ${response.status}: ${response.statusText}`);
  }
  if (response.body === null) {
    throw new Error('streamingFetch: response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const assembled: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames end on a blank line (\n\n). Drain complete frames.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const parsed = parseSSEFrame(frame);
      if (parsed === null) continue;
      assembled.push(parsed.data);
      opts.onChunk?.(parsed.data, parsed.event);
    }
  }
  return assembled.join('');
}

/**
 * Parse a single SSE frame text → `{event, data}`. Comments (`:ping`)
 * and blank frames return `null`.
 */
export function parseSSEFrame(
  frame: string,
): { event: string; data: string; id?: string } | null {
  const lines = frame.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n'), ...(id !== undefined ? { id } : {}) };
}
