/**
 * Kernel prior-turns loader — reads recent thread_events from the
 * existing brain conversation tables and serialises them into the
 * shape the central-intelligence kernel's `priorTurnsLoader` port
 * expects.
 *
 * Thread memory is the primary mechanism for continuity — every
 * personal Jarvis remembers the last K turns of a thread so it can
 * reference them. The kernel maps these to its message history.
 *
 * Read-only; never mutates the conversation log.
 */

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { threadEvents } from '../schemas/conversation.schema.js';
import type { DatabaseClient } from '../client.js';

// drizzle's `inArray` enforces exact-literal-union typing on enum
// columns, but our consumers pass narrower `as const` arrays at the
// call site; alias the typed-array cast at the import boundary so
// individual call sites stay clean.
type ThreadEventKindLiteral =
  | 'user_message' | 'persona_message' | 'tool_call' | 'tool_result'
  | 'handoff_out' | 'handoff_in' | 'review_requested'
  | 'review_decision' | 'system_note';

export interface KernelPriorTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface KernelMemoryDeps {
  readonly tenantId: string | null;
  /** Maximum turns to return per call. Default 10. */
  readonly maxTurns?: number;
  /** Recent-turn window for cognitive-load throttling. Default 5 min. */
  readonly recentWindowMs?: number;
}

export interface KernelMemoryService {
  loadPriorTurns(threadId: string): Promise<ReadonlyArray<KernelPriorTurn>>;
  countRecentUserTurns(threadId: string): Promise<number>;
}

const RELEVANT_KINDS: ReadonlyArray<ThreadEventKindLiteral> = [
  'user_message',
  'persona_message',
];

export function createKernelMemoryService(
  db: DatabaseClient,
  deps: KernelMemoryDeps,
): KernelMemoryService {
  const max = deps.maxTurns ?? 10;
  const windowMs = deps.recentWindowMs ?? 5 * 60 * 1000;

  return {
    async loadPriorTurns(threadId) {
      const baseConditions = [
        eq(threadEvents.threadId, threadId),
        inArray(threadEvents.kind, [...RELEVANT_KINDS]),
      ];
      if (deps.tenantId) baseConditions.push(eq(threadEvents.tenantId, deps.tenantId));

      const rows = await db
        .select({
          kind: threadEvents.kind,
          payload: threadEvents.payload,
          createdAt: threadEvents.createdAt,
        })
        .from(threadEvents)
        .where(and(...baseConditions))
        .orderBy(desc(threadEvents.createdAt))
        .limit(max);

      // rows are newest-first; the kernel wants oldest-first message history.
      return rows.reverse().map((r) => mapRowToTurn(r.kind as string, r.payload));
    },

    async countRecentUserTurns(threadId) {
      const since = new Date(Date.now() - windowMs);
      const baseConditions = [
        eq(threadEvents.threadId, threadId),
        eq(threadEvents.kind, 'user_message' as ThreadEventKindLiteral),
        gte(threadEvents.createdAt, since),
      ];
      if (deps.tenantId) baseConditions.push(eq(threadEvents.tenantId, deps.tenantId));

      const rows = await db
        .select({ id: threadEvents.id })
        .from(threadEvents)
        .where(and(...baseConditions));

      return rows.length;
    },
  };
}

function mapRowToTurn(kind: string, payload: unknown): KernelPriorTurn {
  const role: 'user' | 'assistant' = kind === 'user_message' ? 'user' : 'assistant';
  const content = extractContent(payload);
  return { role, content };
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  if (typeof p.text === 'string') return p.text;
  if (typeof p.content === 'string') return p.content;
  if (typeof p.message === 'string') return p.message;
  // Fall back to stringified payload — better than empty for memory continuity.
  try {
    return JSON.stringify(p).slice(0, 500);
  } catch {
    return '';
  }
}
