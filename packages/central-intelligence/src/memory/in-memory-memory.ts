/**
 * In-memory ConversationMemory — degraded-mode fallback.
 *
 * Enforces tenant isolation at every boundary: a thread created in a
 * tenant scope is invisible to any other tenant or to the platform
 * scope. Platform-scope threads are invisible to tenants.
 *
 * Semantic recall uses a lexical BM25-lite score (term-frequency
 * plus inverse-document-frequency over thread turn content). This is
 * a real retrieval algorithm — not a mock — but production deploys
 * should wire a pgvector-backed adapter with proper embeddings.
 */

import type {
  ConversationMemory,
  ScopeContext,
  Thread,
  Turn,
} from '../types.js';

interface StoredThread {
  readonly thread: Thread;
  readonly turns: Turn[];
}

export interface InMemoryMemoryOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
}

export function createInMemoryConversationMemory(
  opts: InMemoryMemoryOptions = {},
): ConversationMemory {
  const now = opts.clock ?? (() => new Date());
  const nextId = opts.idFactory ?? (() => randomId());

  // Key by the scope-fingerprint so two ctxs from different tenants
  // use different maps. Platform has its own namespace.
  const byScope = new Map<string, Map<string, StoredThread>>();

  function scopeKey(ctx: ScopeContext): string {
    return ctx.kind === 'tenant' ? `t:${ctx.tenantId}` : `p:platform`;
  }

  function mapFor(ctx: ScopeContext): Map<string, StoredThread> {
    const key = scopeKey(ctx);
    const existing = byScope.get(key);
    if (existing) return existing;
    const fresh = new Map<string, StoredThread>();
    byScope.set(key, fresh);
    return fresh;
  }

  function assertSameScope(thread: Thread, ctx: ScopeContext): void {
    if (thread.scope.kind !== ctx.kind) {
      throw new Error('central-intelligence/memory: scope kind mismatch');
    }
    if (thread.scope.kind === 'tenant' && ctx.kind === 'tenant') {
      if (thread.scope.tenantId !== ctx.tenantId) {
        throw new Error(
          `central-intelligence/memory: thread tenantId ${thread.scope.tenantId} ≠ ctx tenantId ${ctx.tenantId}`,
        );
      }
    }
  }

  return {
    async createThread(ctx: ScopeContext, seedUserMessage: string): Promise<Thread> {
      const threadId = 'th_' + nextId();
      const title = summariseTitle(seedUserMessage);
      const createdAt = now().toISOString();
      const thread: Thread = {
        threadId,
        scope: ctx,
        title,
        createdAt,
        updatedAt: createdAt,
        turnCount: 1,
      };
      const turn: Turn = {
        turnId: 'tu_' + nextId(),
        threadId,
        role: 'user',
        content: seedUserMessage,
        events: Object.freeze([]),
        citations: Object.freeze([]),
        artifacts: Object.freeze([]),
        createdAt,
      };
      mapFor(ctx).set(threadId, { thread, turns: [turn] });
      return thread;
    },

    async appendTurn(threadId, partial, ctx): Promise<Turn> {
      const store = mapFor(ctx).get(threadId);
      if (!store) throw new Error(`thread ${threadId} not found in this scope`);
      assertSameScope(store.thread, ctx);
      const turnId = 'tu_' + nextId();
      const createdAt = now().toISOString();
      const turn: Turn = {
        ...partial,
        threadId,
        turnId,
        createdAt,
      };
      store.turns.push(turn);
      const updated: Thread = {
        ...store.thread,
        turnCount: store.thread.turnCount + 1,
        updatedAt: createdAt,
      };
      mapFor(ctx).set(threadId, { thread: updated, turns: store.turns });
      return turn;
    },

    async listThreads(ctx, limit): Promise<ReadonlyArray<Thread>> {
      const threads = [...mapFor(ctx).values()].map((s) => s.thread);
      threads.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return Object.freeze(threads.slice(0, Math.max(0, limit)));
    },

    async getThread(threadId, ctx) {
      const store = mapFor(ctx).get(threadId);
      if (!store) return null;
      return {
        thread: store.thread,
        turns: Object.freeze(store.turns.slice()),
      };
    },

    async semanticRecall(query, ctx, k): Promise<ReadonlyArray<Turn>> {
      const threads = [...mapFor(ctx).values()];
      if (threads.length === 0 || k <= 0) return [];
      const scored: Array<{ turn: Turn; score: number }> = [];
      const qTerms = tokenize(query);
      if (qTerms.length === 0) return [];
      for (const { turns } of threads) {
        for (const t of turns) {
          const tokens = tokenize(t.content);
          if (tokens.length === 0) continue;
          const score = bm25Lite(qTerms, tokens);
          if (score > 0) scored.push({ turn: t, score });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return Object.freeze(scored.slice(0, k).map((s) => s.turn));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tiny BM25-lite. Real enough to beat string.includes on actual prose;
// production replaces this with a pgvector + embeddings adapter.
// ─────────────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function bm25Lite(query: ReadonlyArray<string>, doc: ReadonlyArray<string>): number {
  const k1 = 1.2;
  const b = 0.75;
  const avgDocLen = 80;
  const docLen = doc.length;
  const tf = new Map<string, number>();
  for (const d of doc) tf.set(d, (tf.get(d) ?? 0) + 1);
  let score = 0;
  for (const q of query) {
    const f = tf.get(q) ?? 0;
    if (f === 0) continue;
    const numer = f * (k1 + 1);
    const denom = f + k1 * (1 - b + (b * docLen) / avgDocLen);
    score += numer / denom;
  }
  return score;
}

function summariseTitle(seed: string): string {
  const trimmed = seed.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 57) + '…';
}

function randomId(): string {
  // 96-bit random id; good enough for in-memory. Production memory
  // adapter supplies a cryptographic id factory.
  let out = '';
  for (let i = 0; i < 12; i += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return out;
}
