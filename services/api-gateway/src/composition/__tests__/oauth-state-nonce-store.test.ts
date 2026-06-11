/**
 * oauth-state-nonce-store tests — DURABLE cluster-wide single-use consumption
 * of connector-OAuth state nonces (migration 0343).
 *
 * THE scenario this pins: the v1 in-process replay guard is PER-PROCESS, so
 * on the multi-replica Helm deploy (api-gateway minReplicas 2-3) a captured
 * `state` replayed against a DIFFERENT replica sails through the in-process
 * map. The durable Postgres consume must reject it:
 *
 *   - replica A consumes a nonce → 'consumed' (exactly once cluster-wide);
 *   - replica B (its OWN fresh in-process guard happily accepts the nonce —
 *     demonstrating the per-process hole) → durable consume → 'replayed';
 *   - an unreachable ledger → 'failed' (the caller rejects — fail-closed);
 *   - the RLS GUC is bound from the verified state INSIDE the transaction.
 *
 * The db fake mirrors the recording-stub idiom of
 * middleware/__tests__/database-rls-guc.test.ts: it walks the drizzle SQL
 * object's queryChunks to recover the statement text + bound params, then
 * emulates the `INSERT … ON CONFLICT (nonce) DO NOTHING RETURNING nonce`
 * arbiter over a shared in-memory Set (the "cluster" Postgres).
 */

import { describe, it, expect } from 'vitest';

import { createOAuthStateReplayGuard } from '../connector-oauth-descriptors.js';
import {
  consumeOAuthStateNonceDurably,
  OAUTH_STATE_NONCE_RETENTION_MINUTES,
  type OAuthNonceDb,
} from '../oauth-state-nonce-store.js';

// ── Drizzle SQL introspection (recording-stub idiom) ─────────────────

interface RecordedCall {
  readonly sqlText: string;
  readonly params: ReadonlyArray<unknown>;
}

function extractSqlAndParams(input: unknown): RecordedCall {
  const stringParts: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: ReadonlyArray<unknown>): void => {
    for (const chunk of chunks) {
      if (chunk === null || chunk === undefined) continue;
      if (typeof chunk !== 'object') {
        params.push(chunk);
        continue;
      }
      const chunkObj = chunk as {
        value?: unknown;
        queryChunks?: ReadonlyArray<unknown>;
      };
      if (Array.isArray(chunkObj.queryChunks)) {
        walk(chunkObj.queryChunks);
        continue;
      }
      // A bare object interpolation (e.g. a Date) is the bound value itself —
      // neither a StringChunk nor a Param wrapper.
      if (!('value' in chunkObj)) {
        params.push(chunk);
        stringParts.push(`$${params.length}`);
        continue;
      }
      const value = chunkObj.value;
      if (Array.isArray(value)) {
        // StringChunk — literal SQL text.
        stringParts.push((value as string[]).join(''));
      } else if (value !== undefined) {
        // Param — a bound value.
        params.push(value);
        stringParts.push(`$${params.length}`);
      }
    }
  };
  const sqlObj = input as { queryChunks?: ReadonlyArray<unknown> };
  if (Array.isArray(sqlObj?.queryChunks)) walk(sqlObj.queryChunks);
  return { sqlText: stringParts.join(''), params };
}

// ── The shared "cluster Postgres" fake ───────────────────────────────

interface ClusterPg {
  readonly db: OAuthNonceDb;
  readonly consumedNonces: Set<string>;
  readonly gucBindings: string[];
  readonly insertParams: Array<ReadonlyArray<unknown>>;
}

/** One fake Postgres shared by every "replica". Emulates the ON CONFLICT
 *  (nonce) DO NOTHING RETURNING arbiter over a Set. */
function createClusterPg(): ClusterPg {
  const consumedNonces = new Set<string>();
  const gucBindings: string[] = [];
  const insertParams: Array<ReadonlyArray<unknown>>= [];
  const tx = {
    async execute(q: unknown): Promise<unknown> {
      const { sqlText, params } = extractSqlAndParams(q);
      if (sqlText.includes('set_config')) {
        gucBindings.push(String(params[0]));
        return [];
      }
      if (sqlText.includes('INSERT INTO oauth_state_nonces')) {
        insertParams.push(params);
        // Param order: [retentionMinutes, nonce, tenantId, connectorId, Date]
        const nonce = String(params[1]);
        if (consumedNonces.has(nonce)) return []; // conflict → DO NOTHING
        consumedNonces.add(nonce);
        return [{ nonce }];
      }
      return [];
    },
  };
  const db: OAuthNonceDb = {
    async transaction<T>(
      cb: (t: { execute(q: unknown): Promise<unknown> }) => Promise<T>,
    ): Promise<T> {
      return cb(tx);
    },
  };
  return { db, consumedNonces, gucBindings, insertParams };
}

const ARGS = {
  nonce: 'nonce-abc-123',
  tenantId: 't-1',
  connectorId: 'slack',
  expMs: Date.now() + 10 * 60 * 1000,
} as const;

// ── Tests ─────────────────────────────────────────────────────────────

describe('durable nonce consume — cross-replica replay', () => {
  it('rejects the second consumer: replica B in-process guard PASSES but the durable ledger says replayed', async () => {
    const cluster = createClusterPg();

    // Replica A — its in-process fast-path accepts, then durably consumes.
    const guardA = createOAuthStateReplayGuard();
    expect(guardA.consume(ARGS.nonce, ARGS.expMs)).toBe(true);
    await expect(
      consumeOAuthStateNonceDurably(cluster.db, ARGS),
    ).resolves.toBe('consumed');

    // Replica B — a DIFFERENT process: its OWN fresh in-process guard has
    // never seen the nonce, so the per-process check happily accepts it
    // (the exact hole the durable ledger closes) …
    const guardB = createOAuthStateReplayGuard();
    expect(guardB.consume(ARGS.nonce, ARGS.expMs)).toBe(true);
    // … and the shared Postgres arbiter rejects the replay.
    await expect(
      consumeOAuthStateNonceDurably(cluster.db, ARGS),
    ).resolves.toBe('replayed');

    // Exactly one durable row ever existed for the nonce.
    expect(cluster.consumedNonces.size).toBe(1);
  });

  it('distinct nonces each consume exactly once', async () => {
    const cluster = createClusterPg();
    await expect(
      consumeOAuthStateNonceDurably(cluster.db, ARGS),
    ).resolves.toBe('consumed');
    await expect(
      consumeOAuthStateNonceDurably(cluster.db, { ...ARGS, nonce: 'other-9' }),
    ).resolves.toBe('consumed');
    expect(cluster.consumedNonces.size).toBe(2);
  });

  it('binds the RLS GUC from the verified state inside the consume transaction', async () => {
    const cluster = createClusterPg();
    await consumeOAuthStateNonceDurably(cluster.db, ARGS);
    expect(cluster.gucBindings).toEqual(['t-1']);
    // The insert carries the retention horizon + nonce + tenant + connector.
    const params = cluster.insertParams[0]!;
    expect(params[0]).toBe(OAUTH_STATE_NONCE_RETENTION_MINUTES);
    expect(params[1]).toBe(ARGS.nonce);
    expect(params[2]).toBe(ARGS.tenantId);
    expect(params[3]).toBe(ARGS.connectorId);
    expect(params[4]).toBeInstanceOf(Date);
  });

  it("resolves 'failed' (never throws) when the ledger is unreachable — caller rejects fail-closed", async () => {
    const deadDb: OAuthNonceDb = {
      async transaction(): Promise<never> {
        throw new Error('connection refused');
      },
    };
    await expect(
      consumeOAuthStateNonceDurably(deadDb, ARGS),
    ).resolves.toBe('failed');
  });
});
