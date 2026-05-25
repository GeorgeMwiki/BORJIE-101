/**
 * Append-only message log with SHA-256 hash chain.
 *
 * `appendMessage` reads the latest hash for the thread, computes the
 * next hash, writes the row, and returns it. Callers cannot pre-set
 * the `hash` field — it's computed here. Tampering with a stored row
 * breaks `verifyMessageChain` on next inspection.
 */

import {
  computeMessageHash,
  verifyMessageChain,
  type ChainVerifyResult,
  type MessageHashRow,
} from './hash-chain.js';
import type { Message, MessageRole } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Repository port
// ─────────────────────────────────────────────────────────────────────

export interface MessageRepository {
  insert(args: { readonly tenantId: string; readonly row: Message }): Promise<Message>;
  /** Latest message in a thread (highest createdAt) — null when empty. */
  latestInThread(args: {
    readonly tenantId: string;
    readonly threadId: string;
  }): Promise<Message | null>;
  list(args: {
    readonly tenantId: string;
    readonly threadId: string;
    readonly limit?: number;
  }): Promise<ReadonlyArray<Message>>;
}

// ─────────────────────────────────────────────────────────────────────
// Append
// ─────────────────────────────────────────────────────────────────────

export interface AppendMessageArgs {
  readonly tenantId: string;
  readonly threadId: string;
  /** Chain root from the thread row. Used when no message exists yet. */
  readonly chainRootHash: string;
  readonly role: MessageRole;
  readonly contentJsonb: Record<string, unknown>;
  readonly parentMessageId?: string;
  readonly toolCallsJsonb?: Record<string, unknown>;
  readonly artifactRefIds?: ReadonlyArray<string>;
  readonly actionPlanIds?: ReadonlyArray<string>;
  readonly assetRefs?: ReadonlyArray<string>;
  readonly idGenerator: () => string;
  readonly now?: () => Date;
  readonly repository: MessageRepository;
}

export async function appendMessage(args: AppendMessageArgs): Promise<Message> {
  const now = args.now?.() ?? new Date();
  const latest = await args.repository.latestInThread({
    tenantId: args.tenantId,
    threadId: args.threadId,
  });
  const prevHash = latest?.hash ?? args.chainRootHash;
  const hash = computeMessageHash({
    prevHash,
    threadId: args.threadId,
    role: args.role,
    contentJsonb: args.contentJsonb,
    createdAtIso: now.toISOString(),
  });
  const row: Message = {
    id: args.idGenerator(),
    threadId: args.threadId,
    tenantId: args.tenantId,
    role: args.role,
    contentJsonb: args.contentJsonb,
    prevHash,
    hash,
    createdAt: now,
    ...(args.parentMessageId !== undefined
      ? { parentMessageId: args.parentMessageId }
      : {}),
    ...(args.toolCallsJsonb !== undefined
      ? { toolCallsJsonb: args.toolCallsJsonb }
      : {}),
    ...(args.artifactRefIds !== undefined
      ? { artifactRefIds: [...args.artifactRefIds] }
      : {}),
    ...(args.actionPlanIds !== undefined
      ? { actionPlanIds: [...args.actionPlanIds] }
      : {}),
    ...(args.assetRefs !== undefined ? { assetRefs: [...args.assetRefs] } : {}),
  };
  return args.repository.insert({ tenantId: args.tenantId, row });
}

// ─────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────

export async function listMessages(args: {
  readonly tenantId: string;
  readonly threadId: string;
  readonly limit?: number;
  readonly repository: MessageRepository;
}): Promise<ReadonlyArray<Message>> {
  return args.repository.list({
    tenantId: args.tenantId,
    threadId: args.threadId,
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Verify chain
// ─────────────────────────────────────────────────────────────────────

export async function verifyThreadChain(args: {
  readonly tenantId: string;
  readonly threadId: string;
  readonly chainRootHash: string;
  readonly repository: MessageRepository;
}): Promise<ChainVerifyResult> {
  const messages = await args.repository.list({
    tenantId: args.tenantId,
    threadId: args.threadId,
  });
  const rows: MessageHashRow[] = messages.map((m) => ({
    threadId: m.threadId,
    role: m.role,
    contentJsonb: m.contentJsonb,
    createdAt: m.createdAt,
    prevHash: m.prevHash,
    hash: m.hash,
  }));
  return verifyMessageChain({
    chainRootHash: args.chainRootHash,
    messages: rows,
  });
}

// ─────────────────────────────────────────────────────────────────────
// In-memory repository
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryMessageRepository(): MessageRepository {
  const byTenant = new Map<string, Map<string, Message[]>>();
  function bucket(tenantId: string): Map<string, Message[]> {
    let m = byTenant.get(tenantId);
    if (!m) {
      m = new Map();
      byTenant.set(tenantId, m);
    }
    return m;
  }

  return {
    async insert({ tenantId, row }) {
      const b = bucket(tenantId);
      let list = b.get(row.threadId);
      if (!list) {
        list = [];
        b.set(row.threadId, list);
      }
      list.push(row);
      return row;
    },
    async latestInThread({ tenantId, threadId }) {
      const b = bucket(tenantId);
      const list = b.get(threadId);
      if (!list || list.length === 0) return null;
      // Oldest first stored; latest is the last element.
      return list[list.length - 1] ?? null;
    },
    async list({ tenantId, threadId, limit }) {
      const list = bucket(tenantId).get(threadId) ?? [];
      const out = list.slice();
      if (typeof limit === 'number' && limit > 0) {
        return out.slice(0, limit);
      }
      return out;
    },
  };
}
