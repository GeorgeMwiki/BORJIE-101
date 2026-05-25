import { vi } from 'vitest';
import type { FetchLike } from '../adapter-contract.js';

/**
 * Deterministic fake fetch — records every call and returns caller-supplied
 * JSON. Used by every adapter test so no real network call is made.
 */
export function makeFakeFetch(scripts: {
  [key: string]: {
    status?: number;
    statusText?: string;
    body?: unknown;
    throwOnCall?: Error;
  };
}): FetchLike & {
  calls: { url: string; init: Parameters<FetchLike>[1] }[];
} {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fakeFetch = vi.fn(async (url: string, init: Parameters<FetchLike>[1]) => {
    calls.push({ url, init });
    // Match either by exact URL or by substring key. When multiple
    // substrings match the URL, prefer the one whose start position
    // is latest — a URL like `.../workorders/sc_99/checkin` should
    // match `/checkin` (the intended suffix) over the generic prefix
    // `/v3/workorders`.
    const keys = Object.keys(scripts);
    const exact = keys.find((k) => url === k);
    const matchKey =
      exact ??
      keys
        .filter((k) => url.includes(k))
        .sort((a, b) => url.lastIndexOf(b) - url.lastIndexOf(a))[0];
    const script = matchKey ? scripts[matchKey] : undefined;
    if (!script) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        async text() {
          return '';
        },
        async json() {
          return {};
        },
      };
    }
    if (script.throwOnCall) throw script.throwOnCall;
    const status = script.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: script.statusText ?? 'OK',
      async text() {
        return typeof script.body === 'string' ? script.body : JSON.stringify(script.body ?? {});
      },
      async json() {
        return script.body ?? {};
      },
    };
  });
  // Attach the call log so tests can inspect it.
  (fakeFetch as unknown as { calls: typeof calls }).calls = calls;
  return fakeFetch as unknown as FetchLike & { calls: typeof calls };
}

export function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}
