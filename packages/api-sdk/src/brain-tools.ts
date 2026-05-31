/**
 * Typed brain-tool clients for @borjie/api-sdk.
 *
 * Wraps the universal `BorjieClient.request` with retry + the typed
 * error hierarchy from ./errors.ts, and exposes a curated method set
 * per brain-tool category. New surfaces SHOULD land here so external
 * agents discover them via SDK autocomplete instead of via free-form
 * `request()` calls.
 *
 *   chat, drafts, estate, compliance, opportunities, risks,
 *   decisions, entities, reminders, share, bulk, undo, scope
 *
 * Each category exposes a small set of verbs that mirror the CLI
 * commands and the brain-tool surface.
 */

import {
  ApiSdkError,
  type BorjieClient,
} from './client.js';
import {
  toBorjieError,
} from './errors.js';
import { retry, type RetryOptions } from './retry.js';
import { consumeSse, type SseFrame } from './sse.js';

type Json = unknown;
type IdempotentKey = string;

function asBorjieError(err: unknown): never {
  if (err instanceof ApiSdkError) throw toBorjieError(err);
  if (err instanceof Error) throw toBorjieError(err);
  throw err;
}

async function safeCall<T>(
  fn: () => Promise<T>,
  retryOpts?: RetryOptions,
): Promise<T> {
  try {
    if (retryOpts) return await retry(fn, retryOpts);
    return await fn();
  } catch (err) {
    asBorjieError(err);
  }
}

export interface ChatSendOptions {
  readonly prompt: string;
  readonly language?: 'sw' | 'en';
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
}

export interface ChatClient {
  /**
   * SSE-stream a teaching response from `/api/v1/brain/teach`. Yields
   * one frame per server-sent event. The caller parses frame.data
   * (typically JSON for `message_chunk` / `ui_block` / `done` events).
   */
  teach(opts: ChatSendOptions): AsyncGenerator<SseFrame, void, void>;
}

function bearerFrom(client: BorjieClient): Promise<string | undefined> {
  const t = client.config.bearerToken;
  if (!t) return Promise.resolve(undefined);
  if (typeof t === 'function') return Promise.resolve(t());
  return Promise.resolve(t);
}

function chatClient(client: BorjieClient): ChatClient {
  return {
    async *teach(opts) {
      const bearer = await bearerFrom(client);
      const headers: Record<string, string> = {};
      if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
      if (client.config.apiKey) headers['X-API-Key'] = client.config.apiKey;
      yield* consumeSse({
        url: `${client.baseUrl.replace(/\/+$/, '')}/api/v1/brain/teach`,
        method: 'POST',
        headers,
        body: {
          prompt: opts.prompt,
          // English default per CLAUDE.md (flipped 2026-05).
          language: opts.language ?? 'en',
          ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    },
  };
}

export interface DraftsClient {
  list(): Promise<Json>;
  get(id: string): Promise<Json>;
  newFromIntent(opts: {
    intent: string;
    idempotencyKey?: IdempotentKey;
  }): Promise<Json>;
  lock(opts: {
    id: string;
    reason?: string;
    idempotencyKey?: IdempotentKey;
  }): Promise<Json>;
  revisions(id: string): Promise<Json>;
}

function draftsClient(client: BorjieClient): DraftsClient {
  return {
    list: () =>
      safeCall(() =>
        client.request({ method: 'GET', path: '/api/v1/owner/drafts' }),
        { attempts: 3 },
      ),
    get: (id) =>
      safeCall(() =>
        client.request({
          method: 'GET',
          path: '/api/v1/owner/drafts/{id}',
          pathParams: { id },
        }),
        { attempts: 3 },
      ),
    newFromIntent: ({ intent, idempotencyKey }) =>
      safeCall(() =>
        client.request({
          method: 'POST',
          path: '/api/v1/owner/drafts/free-form',
          body: { intent },
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        }),
      ),
    lock: ({ id, reason, idempotencyKey }) =>
      safeCall(() =>
        client.request({
          method: 'POST',
          path: '/api/v1/owner/drafts/{id}/lock',
          pathParams: { id },
          body: { reason: reason ?? 'finalized' },
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        }),
      ),
    revisions: (id) =>
      safeCall(() =>
        client.request({
          method: 'GET',
          path: '/api/v1/owner/drafts/{id}/revisions',
          pathParams: { id },
        }),
        { attempts: 3 },
      ),
  };
}

export interface EstateClient {
  sites(): Promise<Json>;
  workers(): Promise<Json>;
}

function estateClient(client: BorjieClient): EstateClient {
  return {
    sites: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/mining/sites' }), {
        attempts: 3,
      }),
    workers: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/workforce' }), {
        attempts: 3,
      }),
  };
}

export interface ComplianceClient {
  status(): Promise<Json>;
}

function complianceClient(client: BorjieClient): ComplianceClient {
  return {
    status: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/compliance/status' }), {
        attempts: 3,
      }),
  };
}

export interface OpportunitiesClient {
  list(): Promise<Json>;
}

function opportunitiesClient(client: BorjieClient): OpportunitiesClient {
  return {
    list: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/opportunities' }), {
        attempts: 3,
      }),
  };
}

export interface RisksClient {
  list(): Promise<Json>;
}

function risksClient(client: BorjieClient): RisksClient {
  return {
    list: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/owner/risks' }), {
        attempts: 3,
      }),
  };
}

export interface DecisionsClient {
  list(): Promise<Json>;
  get(id: string): Promise<Json>;
}

function decisionsClient(client: BorjieClient): DecisionsClient {
  return {
    list: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/decisions' }), {
        attempts: 3,
      }),
    get: (id) =>
      safeCall(() =>
        client.request({
          method: 'GET',
          path: '/api/v1/decisions/{id}',
          pathParams: { id },
        }),
        { attempts: 3 },
      ),
  };
}

export interface EntitiesClient {
  search(q: string): Promise<Json>;
}

function entitiesClient(client: BorjieClient): EntitiesClient {
  return {
    search: (q) =>
      safeCall(() =>
        client.request({
          method: 'GET',
          path: '/api/v1/estate/entities',
          query: { q },
        }),
        { attempts: 3 },
      ),
  };
}

export interface RemindersClient {
  list(): Promise<Json>;
  add(opts: {
    text: string;
    fireAt: string;
    idempotencyKey?: IdempotentKey;
  }): Promise<Json>;
}

function remindersClient(client: BorjieClient): RemindersClient {
  return {
    list: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/owner/reminders' }), {
        attempts: 3,
      }),
    add: ({ text, fireAt, idempotencyKey }) =>
      safeCall(() =>
        client.request({
          method: 'POST',
          path: '/api/v1/owner/reminders',
          body: { text, fireAt },
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        }),
      ),
  };
}

export interface ShareClient {
  create(opts: {
    entityType: string;
    entityId: string;
    idempotencyKey?: IdempotentKey;
  }): Promise<Json>;
}

function shareClient(client: BorjieClient): ShareClient {
  return {
    create: ({ entityType, entityId, idempotencyKey }) =>
      safeCall(() =>
        client.request({
          method: 'POST',
          path: '/api/v1/public/share',
          body: { entityType, entityId },
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        }),
      ),
  };
}

export interface BulkClient {
  apply(opts: {
    operations: ReadonlyArray<Record<string, unknown>>;
    idempotencyKey?: IdempotentKey;
  }): Promise<Json>;
}

function bulkClient(client: BorjieClient): BulkClient {
  return {
    apply: ({ operations, idempotencyKey }) =>
      safeCall(() =>
        client.request({
          method: 'POST',
          path: '/api/v1/owner/bulk',
          body: { operations },
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        }),
      ),
  };
}

export interface UndoClient {
  list(): Promise<Json>;
  undo(opts: {
    journalId: string;
    idempotencyKey?: IdempotentKey;
  }): Promise<Json>;
}

function undoClient(client: BorjieClient): UndoClient {
  return {
    list: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/undo' }), {
        attempts: 3,
      }),
    undo: ({ journalId, idempotencyKey }) =>
      safeCall(() =>
        client.request({
          method: 'POST',
          path: '/api/v1/undo/{id}',
          pathParams: { id: journalId },
          ...(idempotencyKey
            ? { headers: { 'Idempotency-Key': idempotencyKey } }
            : {}),
        }),
      ),
  };
}

export interface ScopeClient {
  tree(): Promise<Json>;
}

function scopeClient(client: BorjieClient): ScopeClient {
  return {
    tree: () =>
      safeCall(() => client.request({ method: 'GET', path: '/api/v1/scope' }), {
        attempts: 3,
      }),
  };
}

export interface BrainToolClients {
  readonly chat: ChatClient;
  readonly drafts: DraftsClient;
  readonly estate: EstateClient;
  readonly compliance: ComplianceClient;
  readonly opportunities: OpportunitiesClient;
  readonly risks: RisksClient;
  readonly decisions: DecisionsClient;
  readonly entities: EntitiesClient;
  readonly reminders: RemindersClient;
  readonly share: ShareClient;
  readonly bulk: BulkClient;
  readonly undo: UndoClient;
  readonly scope: ScopeClient;
}

/**
 * Build the full set of brain-tool clients from an existing
 * `BorjieClient`. Pure function — does not mutate the input.
 */
export function createBrainTools(client: BorjieClient): BrainToolClients {
  return {
    chat: chatClient(client),
    drafts: draftsClient(client),
    estate: estateClient(client),
    compliance: complianceClient(client),
    opportunities: opportunitiesClient(client),
    risks: risksClient(client),
    decisions: decisionsClient(client),
    entities: entitiesClient(client),
    reminders: remindersClient(client),
    share: shareClient(client),
    bulk: bulkClient(client),
    undo: undoClient(client),
    scope: scopeClient(client),
  };
}
