/**
 * Tiny fetch wrapper used by every CLI verb.
 *
 * - Threads the bearer token onto every request.
 * - Provides typed JSON helpers.
 * - Exposes an SSE iterator for streaming endpoints.
 * - Optional `onTrace` hook for --verbose request logging.
 * - Uses ONLY globalThis.fetch so the CLI runs on Node 20+ / Bun /
 *   Deno without extra dependencies. We never import 'node-fetch'.
 */

import type { BorjieCredentials } from './credentials.js';

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodyText: string;
  readonly latencyMs?: number;
  constructor(args: {
    status: number;
    url: string;
    message: string;
    bodyText: string;
    latencyMs?: number;
  }) {
    super(args.message);
    this.name = 'HttpError';
    this.status = args.status;
    this.url = args.url;
    this.bodyText = args.bodyText;
    if (typeof args.latencyMs === 'number') this.latencyMs = args.latencyMs;
  }
}

export interface RequestInitLike {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined | null>>;
}

export interface HttpTraceEvent {
  readonly direction: 'request' | 'response';
  readonly method: string;
  readonly url: string;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly requestId?: string;
}

function buildUrl(base: string, path: string, query?: RequestInitLike['query']): string {
  const trimmed = base.replace(/\/+$/, '');
  const sep = path.startsWith('/') ? '' : '/';
  let url = `${trimmed}${sep}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs.length > 0) url += `?${qs}`;
  }
  return url;
}

export interface HttpClient {
  readonly baseUrl: string;
  request<T>(path: string, init?: RequestInitLike): Promise<T>;
  /**
   * Streaming helper. Yields the raw line groups from an SSE response.
   * The caller is responsible for parsing event names + JSON payloads.
   */
  stream(path: string, init?: RequestInitLike): AsyncGenerator<SseEvent, void, void>;
}

export interface SseEvent {
  readonly event: string | null;
  readonly data: string;
  readonly id: string | null;
}

export interface HttpClientArgs {
  readonly apiBaseUrl: string;
  readonly accessToken: string;
  readonly unauthenticated?: boolean;
  readonly onTrace?: (e: HttpTraceEvent) => void;
}

export function createHttpClient(
  creds: Pick<BorjieCredentials, 'apiBaseUrl' | 'accessToken'> & {
    unauthenticated?: boolean;
    onTrace?: (e: HttpTraceEvent) => void;
  },
): HttpClient {
  const baseUrl = creds.apiBaseUrl;
  const onTrace = creds.onTrace;
  const headers = (init?: RequestInitLike): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    };
    if (!creds.unauthenticated && creds.accessToken) {
      h['Authorization'] = `Bearer ${creds.accessToken}`;
    }
    if (init?.idempotencyKey) {
      h['Idempotency-Key'] = init.idempotencyKey;
    }
    return h;
  };

  return {
    baseUrl,
    async request<T>(path: string, init?: RequestInitLike): Promise<T> {
      const url = buildUrl(baseUrl, path, init?.query);
      const method = init?.method ?? 'GET';
      const body =
        init?.body !== undefined && init.body !== null
          ? typeof init.body === 'string'
            ? init.body
            : JSON.stringify(init.body)
          : null;
      const startedAt = Date.now();
      onTrace?.({ direction: 'request', method, url });
      const res = await globalThis.fetch(url, {
        method,
        headers: headers(init),
        body,
      });
      const text = await res.text();
      const latencyMs = Date.now() - startedAt;
      const requestId = res.headers.get('x-request-id') ?? undefined;
      onTrace?.({
        direction: 'response',
        method,
        url,
        status: res.status,
        latencyMs,
        ...(requestId ? { requestId } : {}),
      });
      if (!res.ok) {
        throw new HttpError({
          status: res.status,
          url,
          message: `HTTP ${res.status} on ${path}`,
          bodyText: text,
          latencyMs,
        });
      }
      if (text.length === 0) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    },
    async *stream(path: string, init?: RequestInitLike) {
      const url = buildUrl(baseUrl, path, init?.query);
      const method = init?.method ?? 'POST';
      const body =
        init?.body !== undefined && init.body !== null
          ? typeof init.body === 'string'
            ? init.body
            : JSON.stringify(init.body)
          : null;
      const startedAt = Date.now();
      onTrace?.({ direction: 'request', method, url });
      const res = await globalThis.fetch(url, {
        method,
        headers: { ...headers(init), Accept: 'text/event-stream' },
        body,
      });
      const requestId = res.headers.get('x-request-id') ?? undefined;
      onTrace?.({
        direction: 'response',
        method,
        url,
        status: res.status,
        latencyMs: Date.now() - startedAt,
        ...(requestId ? { requestId } : {}),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new HttpError({
          status: res.status,
          url,
          message: `HTTP ${res.status} on ${path}`,
          bodyText: errText,
        });
      }
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          yield parseSseEvent(raw);
        }
      }
      const tail = buffer.trim();
      if (tail.length > 0) yield parseSseEvent(tail);
    },
  };
}

function parseSseEvent(raw: string): SseEvent {
  let event: string | null = null;
  let id: string | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { event, id, data: dataLines.join('\n') };
}
