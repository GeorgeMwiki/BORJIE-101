/**
 * Thread CRUD + fork operation.
 *
 * Key behaviours:
 *
 *   - Creating a thread registers a `messageChainRootHash` rooted at
 *     the SHA-256 of (tenant_id || owner_persona_id || thread_id ||
 *     created_at_iso). This becomes the prev_hash of the first
 *     message.
 *
 *   - Customer personas (power_tier 5) get ONE thread per (user ×
 *     channel). The runtime calls `findOrCreateCustomerThread()` so a
 *     new inbound WhatsApp message reuses the existing thread; the
 *     external_channel_session_id is rotated when the 24h window
 *     closes.
 *
 *   - Fork creates a new thread that carries `fork_of_thread_id` +
 *     `fork_of_message_id` for the UI to render a branch.
 */

import { createHash } from 'node:crypto';
import { GENESIS_HASH } from './hash-chain.js';
import type { Channel, Thread } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Repository port
// ─────────────────────────────────────────────────────────────────────

export interface ThreadRepository {
  insert(args: { readonly tenantId: string; readonly row: Thread }): Promise<Thread>;
  update(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly patch: Partial<Omit<Thread, 'id' | 'tenantId' | 'createdAt'>>;
  }): Promise<Thread>;
  findById(args: {
    readonly tenantId: string;
    readonly id: string;
  }): Promise<Thread | null>;
  listForOwner(args: {
    readonly tenantId: string;
    readonly ownerUserId: string;
    readonly ownerPersonaId: string;
    readonly projectId?: string | null;
    readonly includeArchived?: boolean;
  }): Promise<ReadonlyArray<Thread>>;
  /** Locate a customer/channel thread for the same (user, channel). */
  findCustomerThread(args: {
    readonly tenantId: string;
    readonly ownerUserId: string;
    readonly ownerPersonaId: string;
    readonly channel: Channel;
  }): Promise<Thread | null>;
  archive(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly at: Date;
  }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Chain root hash — registered into ai_audit_chain on thread creation
// ─────────────────────────────────────────────────────────────────────

export function computeChainRootHash(args: {
  readonly tenantId: string;
  readonly ownerPersonaId: string;
  readonly threadId: string;
  readonly createdAtIso: string;
}): string {
  const payload = [
    args.tenantId,
    args.ownerPersonaId,
    args.threadId,
    args.createdAtIso,
    GENESIS_HASH,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────
// Create thread
// ─────────────────────────────────────────────────────────────────────

export interface CreateThreadArgs {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly ownerPersonaId: string;
  readonly projectId?: string;
  readonly moduleId?: string;
  readonly title?: string;
  readonly channel?: Channel;
  readonly externalChannelSessionId?: string;
  readonly retentionPolicyId?: string;
  readonly idGenerator: () => string;
  readonly now?: () => Date;
  readonly repository: ThreadRepository;
}

export async function createThread(args: CreateThreadArgs): Promise<Thread> {
  const now = args.now?.() ?? new Date();
  const id = args.idGenerator();
  const channel: Channel = args.channel ?? 'web';
  const rootHash = computeChainRootHash({
    tenantId: args.tenantId,
    ownerPersonaId: args.ownerPersonaId,
    threadId: id,
    createdAtIso: now.toISOString(),
  });

  const row: Thread = {
    id,
    tenantId: args.tenantId,
    ownerUserId: args.ownerUserId,
    ownerPersonaId: args.ownerPersonaId,
    title: args.title ?? 'New conversation',
    pinned: false,
    messageChainRootHash: rootHash,
    channel,
    createdAt: now,
    updatedAt: now,
    ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
    ...(args.moduleId !== undefined ? { moduleId: args.moduleId } : {}),
    ...(args.externalChannelSessionId !== undefined
      ? { externalChannelSessionId: args.externalChannelSessionId }
      : {}),
    ...(args.retentionPolicyId !== undefined
      ? { retentionPolicyId: args.retentionPolicyId }
      : {}),
  };
  return args.repository.insert({ tenantId: args.tenantId, row });
}

// ─────────────────────────────────────────────────────────────────────
// Customer thread — one per (user, channel) with 24h window rollover
// ─────────────────────────────────────────────────────────────────────

/**
 * WhatsApp's Business Messaging API closes a session 24 hours after
 * the LAST customer-initiated message. After that window, businesses
 * either pay for a Message Template or wait for the customer to
 * re-engage. Our model:
 *
 *   - Keep the thread (so conversational history survives).
 *   - Rotate `external_channel_session_id` (a fresh session = a new
 *     billed conversation upstream).
 *
 * Returns `{ thread, sessionRotated }` so the upstream channel adapter
 * can emit the right billing event.
 */
export const WHATSAPP_24H_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface FindOrCreateCustomerThreadResult {
  readonly thread: Thread;
  readonly sessionRotated: boolean;
}

export async function findOrCreateCustomerThread(args: {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly ownerPersonaId: string;
  readonly channel: Channel;
  readonly externalChannelSessionId: string;
  readonly idGenerator: () => string;
  readonly sessionIdGenerator?: () => string;
  readonly now?: () => Date;
  readonly windowMs?: number;
  readonly repository: ThreadRepository;
}): Promise<FindOrCreateCustomerThreadResult> {
  const now = args.now?.() ?? new Date();
  const existing = await args.repository.findCustomerThread({
    tenantId: args.tenantId,
    ownerUserId: args.ownerUserId,
    ownerPersonaId: args.ownerPersonaId,
    channel: args.channel,
  });

  if (!existing) {
    const fresh = await createThread({
      tenantId: args.tenantId,
      ownerUserId: args.ownerUserId,
      ownerPersonaId: args.ownerPersonaId,
      channel: args.channel,
      externalChannelSessionId: args.externalChannelSessionId,
      idGenerator: args.idGenerator,
      ...(args.now ? { now: args.now } : {}),
      repository: args.repository,
    });
    return { thread: fresh, sessionRotated: false };
  }

  const lastAt = existing.lastMessageAt ?? existing.createdAt ?? now;
  const windowMs = args.windowMs ?? WHATSAPP_24H_WINDOW_MS;
  const elapsed = now.getTime() - lastAt.getTime();
  const isOutsideWindow = elapsed > windowMs;

  // Within window — reuse existing session id (or set if missing).
  if (!isOutsideWindow) {
    if (existing.externalChannelSessionId === args.externalChannelSessionId) {
      return { thread: existing, sessionRotated: false };
    }
    // Upstream sent a different session id but we're still inside the
    // window. Trust upstream and update — no billing rotation.
    const updated = await args.repository.update({
      tenantId: args.tenantId,
      id: existing.id,
      patch: {
        externalChannelSessionId: args.externalChannelSessionId,
        updatedAt: now,
      },
    });
    return { thread: updated, sessionRotated: false };
  }

  // Outside window — rotate the session id (new billed conversation).
  const rotatedSessionId =
    args.sessionIdGenerator?.() ?? args.externalChannelSessionId;
  const updated = await args.repository.update({
    tenantId: args.tenantId,
    id: existing.id,
    patch: {
      externalChannelSessionId: rotatedSessionId,
      updatedAt: now,
    },
  });
  return { thread: updated, sessionRotated: true };
}

// ─────────────────────────────────────────────────────────────────────
// Fork
// ─────────────────────────────────────────────────────────────────────

export async function forkThread(args: {
  readonly tenantId: string;
  readonly sourceThreadId: string;
  readonly atMessageId: string;
  readonly title?: string;
  readonly idGenerator: () => string;
  readonly now?: () => Date;
  readonly repository: ThreadRepository;
}): Promise<Thread> {
  const source = await args.repository.findById({
    tenantId: args.tenantId,
    id: args.sourceThreadId,
  });
  if (!source) {
    throw new Error(
      `cannot fork: source thread ${args.sourceThreadId} not found in tenant ${args.tenantId}`,
    );
  }
  const now = args.now?.() ?? new Date();
  const id = args.idGenerator();
  const rootHash = computeChainRootHash({
    tenantId: args.tenantId,
    ownerPersonaId: source.ownerPersonaId,
    threadId: id,
    createdAtIso: now.toISOString(),
  });
  const row: Thread = {
    id,
    tenantId: args.tenantId,
    ownerUserId: source.ownerUserId,
    ownerPersonaId: source.ownerPersonaId,
    title: args.title ?? `${source.title} (fork)`,
    pinned: false,
    messageChainRootHash: rootHash,
    channel: source.channel,
    forkOfThreadId: args.sourceThreadId,
    forkOfMessageId: args.atMessageId,
    createdAt: now,
    updatedAt: now,
    ...(source.projectId !== undefined ? { projectId: source.projectId } : {}),
    ...(source.moduleId !== undefined ? { moduleId: source.moduleId } : {}),
  };
  return args.repository.insert({ tenantId: args.tenantId, row });
}

// ─────────────────────────────────────────────────────────────────────
// Archive
// ─────────────────────────────────────────────────────────────────────

export async function archiveThread(args: {
  readonly tenantId: string;
  readonly id: string;
  readonly now?: () => Date;
  readonly repository: ThreadRepository;
}): Promise<void> {
  const at = args.now?.() ?? new Date();
  await args.repository.archive({
    tenantId: args.tenantId,
    id: args.id,
    at,
  });
}

export async function listThreads(args: {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly ownerPersonaId: string;
  readonly projectId?: string | null;
  readonly includeArchived?: boolean;
  readonly repository: ThreadRepository;
}): Promise<ReadonlyArray<Thread>> {
  return args.repository.listForOwner({
    tenantId: args.tenantId,
    ownerUserId: args.ownerUserId,
    ownerPersonaId: args.ownerPersonaId,
    ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
    ...(args.includeArchived !== undefined
      ? { includeArchived: args.includeArchived }
      : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────
// In-memory repository
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryThreadRepository(): ThreadRepository {
  const byTenant = new Map<string, Map<string, Thread>>();
  function bucket(tenantId: string): Map<string, Thread> {
    let m = byTenant.get(tenantId);
    if (!m) {
      m = new Map();
      byTenant.set(tenantId, m);
    }
    return m;
  }

  return {
    async insert({ tenantId, row }) {
      bucket(tenantId).set(row.id, row);
      return row;
    },
    async update({ tenantId, id, patch }) {
      const b = bucket(tenantId);
      const existing = b.get(id);
      if (!existing) {
        throw new Error(`thread ${id} not found in tenant ${tenantId}`);
      }
      const next: Thread = {
        ...existing,
        ...patch,
        updatedAt: patch.updatedAt ?? new Date(),
      };
      b.set(id, next);
      return next;
    },
    async findById({ tenantId, id }) {
      return bucket(tenantId).get(id) ?? null;
    },
    async listForOwner({ tenantId, ownerUserId, ownerPersonaId, projectId, includeArchived }) {
      const out: Thread[] = [];
      for (const t of bucket(tenantId).values()) {
        if (t.ownerUserId !== ownerUserId) continue;
        if (t.ownerPersonaId !== ownerPersonaId) continue;
        if (projectId !== undefined && projectId !== null && t.projectId !== projectId) continue;
        if (projectId === null && t.projectId !== undefined) continue;
        if (t.archivedAt && !includeArchived) continue;
        out.push(t);
      }
      return out;
    },
    async findCustomerThread({ tenantId, ownerUserId, ownerPersonaId, channel }) {
      for (const t of bucket(tenantId).values()) {
        if (
          t.ownerUserId === ownerUserId &&
          t.ownerPersonaId === ownerPersonaId &&
          t.channel === channel &&
          !t.archivedAt
        ) {
          return t;
        }
      }
      return null;
    },
    async archive({ tenantId, id, at }) {
      const b = bucket(tenantId);
      const existing = b.get(id);
      if (!existing) {
        throw new Error(`thread ${id} not found in tenant ${tenantId}`);
      }
      b.set(id, { ...existing, archivedAt: at, updatedAt: at });
    },
  };
}
