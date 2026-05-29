/**
 * Universal SSE consumer for @borjie/api-sdk.
 *
 * Built on `fetch` streams so it runs on Node 20+, Bun, Deno, and the
 * browser without `EventSource` (which has no body / no Authorization
 * header support outside the browser).
 *
 * Returns an `AsyncGenerator<SseFrame>`. Each frame carries:
 *   - event: the parsed event name (default: 'message')
 *   - data:  the raw string payload (callers parse JSON themselves)
 *   - id:    the optional event id
 *   - retry: the optional reconnection hint
 */

export interface SseFrame {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
  readonly retry: number | null;
}

export interface ConsumeSseOptions {
  readonly fetchFn?: typeof fetch;
  readonly url: string;
  readonly method?: 'POST' | 'GET';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export async function* consumeSse(
  opts: ConsumeSseOptions,
): AsyncGenerator<SseFrame, void, void> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('consumeSse: global fetch is not available; provide fetchFn');
  }
  const init: RequestInit = {
    method: opts.method ?? 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  };
  if (opts.body !== undefined && opts.body !== null) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  if (opts.signal) init.signal = opts.signal;

  const res = await fetchFn(opts.url, init);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`consumeSse: HTTP ${res.status} on ${opts.url}: ${text.slice(0, 200)}`);
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let sep: number;
      // SSE frames are separated by a blank line (\n\n or \r\n\r\n).
      while ((sep = findFrameBoundary(buffer)) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + boundaryLength(buffer, sep));
        const frame = parseFrame(raw);
        if (frame) yield frame;
      }
    }
    const tail = buffer.trim();
    if (tail.length > 0) {
      const frame = parseFrame(tail);
      if (frame) yield frame;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* releaseLock is best-effort */
    }
  }
}

function findFrameBoundary(buffer: string): number {
  const dn = buffer.indexOf('\n\n');
  const rn = buffer.indexOf('\r\n\r\n');
  if (dn < 0) return rn;
  if (rn < 0) return dn;
  return Math.min(dn, rn);
}

function boundaryLength(buffer: string, sep: number): number {
  return buffer.startsWith('\r\n\r\n', sep) ? 4 : 2;
}

function parseFrame(raw: string): SseFrame | null {
  if (raw.length === 0) return null;
  let event = 'message';
  let id: string | null = null;
  let retry: number | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue; // SSE comment
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx);
    const value = line.slice(idx + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'retry') {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) retry = n;
    }
  }
  return { event, id, retry, data: dataLines.join('\n') };
}
