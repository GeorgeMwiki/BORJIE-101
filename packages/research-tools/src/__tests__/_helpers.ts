/**
 * Shared test helpers — fetch stubs, tool-context fixtures, fixture
 * artifacts. Kept off the public surface (filename starts with `_`).
 */

import { vi } from 'vitest';

import { createInMemoryCache } from '../cache/redis-cache.js';
import { createCostTracker } from '../budgets/cost-tracker.js';
import type {
  Cache,
  CostTracker,
  ResearchLogger,
  ToolContext,
} from '../types.js';

export interface FetchStubCall {
  readonly url: string;
  readonly init?: RequestInit;
}

export interface FetchStubResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Record<string, string>;
}

export interface FetchStub {
  readonly fn: typeof fetch;
  readonly calls: ReadonlyArray<FetchStubCall>;
  /** Register a handler keyed by URL substring. Last one registered wins. */
  on(urlSubstring: string, response: FetchStubResponse | Error): void;
}

/**
 * Create a vitest-compatible fetch stub. Adapters call `fn` instead of
 * `globalThis.fetch`; tests register handlers via `on`.
 */
export function createFetchStub(): FetchStub {
  const calls: Array<FetchStubCall> = [];
  const handlers: Array<{ matcher: string; response: FetchStubResponse | Error }> =
    [];

  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const callRecord: FetchStubCall = init === undefined ? { url } : { url, init };
    calls.push(callRecord);

    // Last-matched-wins so tests can override.
    for (let i = handlers.length - 1; i >= 0; i--) {
      const h = handlers[i];
      if (!h) continue;
      if (url.includes(h.matcher)) {
        if (h.response instanceof Error) throw h.response;
        return new Response(h.response.body, {
          status: h.response.status,
          headers: h.response.headers ?? {},
        });
      }
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

  return {
    fn,
    calls,
    on(urlSubstring: string, response: FetchStubResponse | Error) {
      handlers.push({ matcher: urlSubstring, response });
    },
  };
}

// ---------------------------------------------------------------------------
// ToolContext fixture
// ===========================================================================

export interface BuildToolContextOptions {
  readonly cache?: Cache;
  readonly cost_tracker?: CostTracker;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: ResearchLogger;
  readonly budget_usd_cents?: number;
  readonly tenant_id?: string;
  readonly plan_id?: string;
  readonly step_id?: string;
}

export function buildToolContext(
  options: BuildToolContextOptions = {},
): ToolContext {
  const cache = options.cache ?? createInMemoryCache();
  const cost_tracker =
    options.cost_tracker ??
    createCostTracker({
      budget_usd_cents: options.budget_usd_cents ?? 10_000,
    });
  return {
    tenant_id: options.tenant_id ?? 'tenant_test',
    plan_id: options.plan_id ?? 'plan_test',
    step_id: options.step_id ?? 'step_test',
    cache,
    cost_tracker,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  };
}

export function captureLogger(): ResearchLogger & {
  readonly warns: ReadonlyArray<string>;
  readonly infos: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
} {
  const warns: Array<string> = [];
  const infos: Array<string> = [];
  const errors: Array<string> = [];
  return {
    warn: (msg: string) => {
      warns.push(msg);
    },
    info: (msg: string) => {
      infos.push(msg);
    },
    error: (msg: string) => {
      errors.push(msg);
    },
    get warns() {
      return warns;
    },
    get infos() {
      return infos;
    },
    get errors() {
      return errors;
    },
  };
}
