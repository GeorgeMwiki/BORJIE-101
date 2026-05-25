/**
 * Idempotency middleware.
 *
 * Ensures financial / side-effect safety when an agent retries a POST/PUT/PATCH.
 * Uses `X-Idempotency-Key` + a SHA-256 of the request body to detect duplicates.
 *
 * Rules:
 *   - Only POST / PUT / PATCH are idempotency-eligible.
 *   - Only 2xx responses are cached (failures can be retried safely).
 *   - TTL: 24 hours.
 *   - Same key + different body → `IDEMPOTENCY_CONFLICT`.
 *   - Same key + same body → cached response returned verbatim.
 *
 * Storage is injected so this package stays testable and storage-agnostic.
 */

import type { HeadersLike } from './correlation-id.js';
import type { IdempotencyRecord } from './types.js';
import { sha256Hex } from './agent-auth.js';

// ============================================================================
// Storage port
// ============================================================================

export interface IdempotencyStore {
  find(
    key: string,
    agentId: string,
  ): Promise<IdempotencyRecord | null>;
  put(record: IdempotencyRecord): Promise<void>;
  delete(key: string, agentId: string): Promise<void>;
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const map = new Map<string, IdempotencyRecord>();
  const keyOf = (k: string, a: string): string => `${a}::${k}`;
  return {
    async find(key, agentId) {
      return map.get(keyOf(key, agentId)) ?? null;
    },
    async put(record) {
      map.set(keyOf(record.key, record.agentId), record);
    },
    async delete(key, agentId) {
      map.delete(keyOf(key, agentId));
    },
  };
}

// ============================================================================
// Check result
// ============================================================================

export type IdempotencyCheck =
  | {
      readonly kind: 'fresh';
      readonly idempotencyKey?: string;
      readonly requestHash?: string;
    }
  | {
      readonly kind: 'replayed';
      readonly statusCode: number;
      readonly responseBody: string;
    }
  | {
      readonly kind: 'conflict';
    };

const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';
const TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Check
// ============================================================================

export async function checkIdempotency(deps: {
  readonly store: IdempotencyStore;
  readonly method: string;
  readonly headers: HeadersLike;
  readonly body: string;
  readonly agentId: string;
  readonly now?: () => number;
}): Promise<IdempotencyCheck> {
  const method = deps.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    return { kind: 'fresh' };
  }
  const idempotencyKey = deps.headers[IDEMPOTENCY_KEY_HEADER];
  if (!idempotencyKey) return { kind: 'fresh' };

  const now = (deps.now ?? Date.now)();
  const requestHash = await sha256Hex(deps.body);

  const existing = await deps.store.find(idempotencyKey, deps.agentId);
  if (!existing) {
    return { kind: 'fresh', idempotencyKey, requestHash };
  }

  if (new Date(existing.expiresAt).getTime() < now) {
    await deps.store.delete(idempotencyKey, deps.agentId);
    return { kind: 'fresh', idempotencyKey, requestHash };
  }

  if (existing.requestHash !== requestHash) {
    return { kind: 'conflict' };
  }

  return {
    kind: 'replayed',
    statusCode: existing.statusCode,
    responseBody: existing.responseBody,
  };
}

// ============================================================================
// Cache
// ============================================================================

export async function cacheIdempotencyResponse(deps: {
  readonly store: IdempotencyStore;
  readonly idempotencyKey: string;
  readonly agentId: string;
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
  readonly statusCode: number;
  readonly responseBody: string;
  readonly now?: () => number;
}): Promise<void> {
  if (deps.statusCode < 200 || deps.statusCode >= 300) return;
  const now = (deps.now ?? Date.now)();
  const iso = (ts: number): string => new Date(ts).toISOString();
  const record: IdempotencyRecord = {
    key: deps.idempotencyKey,
    agentId: deps.agentId,
    method: deps.method.toUpperCase(),
    path: deps.path,
    requestHash: deps.requestHash,
    statusCode: deps.statusCode,
    responseBody: deps.responseBody,
    createdAt: iso(now),
    expiresAt: iso(now + TTL_MS),
  };
  await deps.store.put(record);
}
