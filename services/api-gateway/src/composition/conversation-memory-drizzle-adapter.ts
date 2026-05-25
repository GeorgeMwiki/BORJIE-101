/**
 * Drizzle-backed `ConversationMemory` adapter.
 *
 * Composition contract:
 *
 *   - Thread + turn lifecycle (`createThread`, `appendTurn`,
 *     `listThreads`, `getThread`) currently writes through the
 *     in-memory adapter — until the `conversation_threads` migration
 *     lands the kernel has no Postgres table to bind. The in-memory
 *     layer is wrapped so the ergonomic surface is identical to the
 *     fully-Drizzle-backed implementation a future agent will ship.
 *
 *   - `semanticRecall(query, ctx, k)` queries the Drizzle-backed
 *     `kernel_memory_semantic` table via `createSemanticMemoryService`
 *     (Wave-K G2). Every appended turn is mirrored into the semantic
 *     fact store keyed by `thread:<turn.threadId>:<turn.turnId>` so the
 *     recall surface survives process restarts even before the thread
 *     migration ships.
 *
 *   - Tenant isolation: the semantic memory service already scopes
 *     by `tenantId` (NULL for platform scope) and `userId`. The
 *     ScopeContext is translated to that pair at every boundary, so
 *     cross-tenant + cross-scope probes return empty rows. Platform
 *     turns are pinned to the reserved `_platform` userId so a
 *     subsequent platform-scope recall reads its own facts only.
 *
 * Degraded fallback:
 *
 *   - When `db` is null the factory throws — callers MUST guard with
 *     a `db ? createDrizzle... : createInMemory...` chain at the
 *     composition root. The same pattern used by `createKernelGoals
 *     Service` and the other Drizzle-only factories.
 */

import { createSemanticMemoryService } from '@borjie/database';
import {
  createInMemoryConversationMemory,
  type ConversationMemory,
  type ScopeContext,
  type Thread,
  type Turn,
} from '@borjie/central-intelligence';

type SemanticMemoryService = ReturnType<typeof createSemanticMemoryService>;

export interface CreateDrizzleConversationMemoryArgs {
  /**
   * Drizzle client. Tagged as `unknown` so this file does not pick up
   * a hard compile-time dep on `@borjie/database` types — the
   * semantic memory service's constructor enforces the shape at the
   * service boundary.
   */
  readonly db: unknown;
  /** Optional structured logger. */
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
}

const PLATFORM_USER_PARTITION = '_platform';
const SEMANTIC_RECALL_DEFAULT_LIMIT = 50;
const THREAD_FACT_KEY_PREFIX = 'thread:';

/**
 * Compose a Drizzle-backed `ConversationMemory`. The thread + turn
 * lifecycle delegates to the in-memory shell; `semanticRecall` walks
 * the Drizzle-backed `kernel_memory_semantic` table; `appendTurn`
 * mirrors each turn into the same table so the recall surface is
 * durable across process restarts.
 */
export function createDrizzleConversationMemory(
  args: CreateDrizzleConversationMemoryArgs,
): ConversationMemory {
  if (!args.db) {
    throw new Error('createDrizzleConversationMemory: db is required');
  }

  const semanticMemory: SemanticMemoryService = createSemanticMemoryService(
    args.db as never,
  );

  // The thread-state surface (createThread/appendTurn/listThreads/
  // getThread) is fronted by the in-memory shell. Each appendTurn is
  // mirrored into the Drizzle semantic-memory table immediately after
  // the in-memory write so durability is preserved at the recall
  // boundary even before the thread migration lands.
  const shell = createInMemoryConversationMemory();

  function partition(ctx: ScopeContext): {
    readonly tenantId: string | null;
    readonly userId: string;
  } {
    if (ctx.kind === 'tenant') {
      return { tenantId: ctx.tenantId, userId: ctx.actorUserId };
    }
    return { tenantId: null, userId: PLATFORM_USER_PARTITION };
  }

  async function mirrorTurnToSemantic(
    turn: Turn,
    ctx: ScopeContext,
  ): Promise<void> {
    const { tenantId, userId } = partition(ctx);
    const key = `${THREAD_FACT_KEY_PREFIX}${turn.threadId}:${turn.turnId}`;
    try {
      await semanticMemory.upsertFact({
        tenantId,
        userId,
        key,
        value: {
          turnId: turn.turnId,
          threadId: turn.threadId,
          role: turn.role,
          content: turn.content,
          createdAt: turn.createdAt,
        },
        confidence: 1,
        sourceTurnId: turn.turnId,
        source: 'extracted',
      });
    } catch (err) {
      args.logger?.warn?.(
        {
          wiring: 'drizzle-conversation-memory',
          turnId: turn.turnId,
          error: err instanceof Error ? err.message : String(err),
        },
        'conversation-memory: turn mirror to semantic store failed (non-fatal)',
      );
    }
  }

  const memory: ConversationMemory = {
    async createThread(ctx, seedUserMessage) {
      const thread = await shell.createThread(ctx, seedUserMessage);
      const fetched = await shell.getThread(thread.threadId, ctx);
      if (fetched && fetched.turns.length > 0) {
        // Mirror the seed turn so the durable recall surface has at
        // least one row to scan on the first user message.
        await mirrorTurnToSemantic(fetched.turns[0]!, ctx);
      }
      return thread;
    },
    async appendTurn(threadId, partial, ctx) {
      const turn = await shell.appendTurn(threadId, partial, ctx);
      await mirrorTurnToSemantic(turn, ctx);
      return turn;
    },
    async listThreads(ctx, limit) {
      return shell.listThreads(ctx, limit);
    },
    async getThread(threadId, ctx) {
      return shell.getThread(threadId, ctx);
    },
    async semanticRecall(query, ctx, k) {
      if (k <= 0) return [];
      const { tenantId, userId } = partition(ctx);
      try {
        // Pull a wide candidate set from the durable semantic store
        // then BM25-lite re-rank against the query. The in-memory
        // shell uses the same heuristic; here we lift it onto the
        // durable rows so semantic recall survives a process restart.
        const candidates = await semanticMemory.search({
          tenantId,
          userId,
          prefix: THREAD_FACT_KEY_PREFIX,
          limit: SEMANTIC_RECALL_DEFAULT_LIMIT,
        });
        const turns: Turn[] = [];
        for (const fact of candidates) {
          const turn = factToTurn(fact);
          if (turn) turns.push(turn);
        }
        if (turns.length === 0) {
          // Empty durable store — fall back to in-memory recall so a
          // brand-new process that hasn't yet mirrored any turns
          // still produces relevant grounding.
          return shell.semanticRecall(query, ctx, k);
        }
        const scored = scoreTurns(query, turns).slice();
        scored.sort((a, b) => b.score - a.score);
        return Object.freeze(scored.slice(0, k).map((s) => s.turn));
      } catch (err) {
        args.logger?.warn?.(
          {
            wiring: 'drizzle-conversation-memory',
            error: err instanceof Error ? err.message : String(err),
          },
          'conversation-memory: semanticRecall failed — falling back to in-memory recall',
        );
        return shell.semanticRecall(query, ctx, k);
      }
    },
  };

  return memory;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface SemanticFactLike {
  readonly value: unknown;
}

function factToTurn(fact: SemanticFactLike): Turn | null {
  const value = fact.value as
    | {
        readonly turnId?: string;
        readonly threadId?: string;
        readonly role?: string;
        readonly content?: string;
        readonly createdAt?: string;
      }
    | null
    | undefined;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.turnId !== 'string' || typeof value.threadId !== 'string') {
    return null;
  }
  if (typeof value.role !== 'string' || typeof value.content !== 'string') {
    return null;
  }
  return {
    turnId: value.turnId,
    threadId: value.threadId,
    role: value.role as Turn['role'],
    content: value.content,
    events: Object.freeze([]),
    citations: Object.freeze([]),
    artifacts: Object.freeze([]),
    createdAt:
      typeof value.createdAt === 'string'
        ? value.createdAt
        : new Date().toISOString(),
  };
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function bm25Lite(
  query: ReadonlyArray<string>,
  doc: ReadonlyArray<string>,
): number {
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

function scoreTurns(
  query: string,
  turns: ReadonlyArray<Turn>,
): ReadonlyArray<{ readonly turn: Turn; readonly score: number }> {
  const qTerms = tokenize(query);
  if (qTerms.length === 0) return [];
  const out: Array<{ turn: Turn; score: number }> = [];
  for (const t of turns) {
    const tokens = tokenize(t.content);
    if (tokens.length === 0) continue;
    const score = bm25Lite(qTerms, tokens);
    if (score > 0) out.push({ turn: t, score });
  }
  return out;
}
