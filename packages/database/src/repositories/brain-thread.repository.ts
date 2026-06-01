/**
 * BrainThreadRepository — Postgres-backed persistence for the Brain's Thread
 * Store. Implements the shape required by `@borjie/ai-copilot`'s
 * `ThreadStoreBackend` interface (duck-typed; we don't import the package to
 * keep dependency direction one-way: ai-copilot -> database).
 *
 * Storage model mirrors the in-memory contract:
 *  - threads: one row per conversation, append-only status transitions
 *  - thread_events: append-only log; kind-specific payload in `payload`
 *  - handoff_packets: normalized copy of handoff_out payloads for fast audit
 */

import { and, eq, desc } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { withTenantContext } from '../rls/with-tenant-context.js';
import { threads, threadEvents, handoffPackets } from '../schemas/conversation.schema.js';

export interface BrainThread {
  id: string;
  tenantId: string;
  initiatingUserId: string;
  primaryPersonaId: string;
  teamId?: string;
  employeeId?: string;
  title: string;
  status: 'open' | 'resolved' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface BrainThreadEvent {
  id: string;
  threadId: string;
  kind:
    | 'user_message'
    | 'persona_message'
    | 'tool_call'
    | 'tool_result'
    | 'handoff_out'
    | 'handoff_in'
    | 'review_requested'
    | 'review_decision'
    | 'system_note';
  actorId: string;
  visibility: {
    scope: 'private' | 'team' | 'management' | 'public';
    authorActorId: string;
    initiatingUserId?: string;
    teamId?: string;
    rationale?: string;
  };
  parentEventId?: string;
  createdAt: string;
  /** Kind-specific payload. See @borjie/ai-copilot/thread/thread-store. */
  [key: string]: unknown;
}

interface ListThreadsOptions {
  userId?: string;
  teamId?: string;
  employeeId?: string;
  personaId?: string;
  status?: BrainThread['status'];
  limit?: number;
}

export class BrainThreadRepository {
  constructor(private readonly db: DatabaseClient) {}

  // -------------------------------------------------------------------------
  // RLS connection pinning
  // -------------------------------------------------------------------------
  // This repo is built ONCE per tenant inside the Brain registry and shared
  // across all concurrent requests/turns for that tenant (its `db` is a
  // process-singleton pool). A brain turn interleaves thread-store DB writes
  // with multi-second LLM calls, so binding the tenant GUC at the session
  // level (the old route-level `set_config(..., false)`) could be clobbered
  // by a concurrent turn between a write and the next read. Every method
  // therefore binds tenant context PER OPERATION via `withTenantContext`
  // (a short `SET LOCAL` transaction on one pinned connection) so each
  // statement runs on a connection carrying the correct tenant GUC. The
  // optional-`tenantId` read methods fall back to the bare client when no
  // tenant is supplied (legacy/no-RLS call sites + the integration test).

  async createThread(
    t: Omit<BrainThread, 'createdAt' | 'updatedAt'>
  ): Promise<BrainThread> {
    const now = new Date();
    await withTenantContext(this.db, t.tenantId, (tx) =>
      tx.insert(threads).values({
        id: t.id,
        tenantId: t.tenantId,
        initiatingUserId: t.initiatingUserId,
        primaryPersonaId: t.primaryPersonaId,
        teamId: t.teamId ?? null,
        employeeId: t.employeeId ?? null,
        title: t.title,
        status: t.status,
        eventCount: 0,
        lastEventAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return {
      ...t,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getThread(threadId: string, tenantId?: string): Promise<BrainThread | null> {
    // Belt-and-braces: filter by tenantId when supplied (RLS is the backstop).
    // When a tenantId is given we also pin the read inside a per-tenant
    // transaction so the RLS GUC is bound on the connection it runs on.
    const run = async (db: DatabaseClient): Promise<BrainThread | null> => {
      const conds = [eq(threads.id, threadId)];
      if (tenantId) conds.push(eq(threads.tenantId, tenantId));
      const row = await db.select().from(threads).where(and(...conds)).limit(1);
      const r = row[0];
      return r ? rowToThread(r) : null;
    };
    return tenantId ? withTenantContext(this.db, tenantId, run) : run(this.db);
  }

  async listThreads(
    tenantId: string,
    opts: ListThreadsOptions = {}
  ): Promise<BrainThread[]> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const conds = [eq(threads.tenantId, tenantId)];
      if (opts.userId) conds.push(eq(threads.initiatingUserId, opts.userId));
      if (opts.teamId) conds.push(eq(threads.teamId, opts.teamId));
      if (opts.employeeId) conds.push(eq(threads.employeeId, opts.employeeId));
      if (opts.personaId) conds.push(eq(threads.primaryPersonaId, opts.personaId));
      if (opts.status) conds.push(eq(threads.status, opts.status));
      const q = tx
        .select()
        .from(threads)
        .where(and(...conds))
        .orderBy(desc(threads.updatedAt));
      const rows = opts.limit ? await q.limit(opts.limit) : await q;
      return rows.map(rowToThread);
    });
  }

  async archiveThread(threadId: string, tenantId?: string): Promise<void> {
    // Same tenant-scoped contract as getThread. When a tenantId is supplied
    // the update is pinned inside a per-tenant transaction (GUC bound on the
    // connection); the app-level filter remains belt-and-braces.
    const run = async (db: DatabaseClient): Promise<void> => {
      const conds = [eq(threads.id, threadId)];
      if (tenantId) conds.push(eq(threads.tenantId, tenantId));
      await db
        .update(threads)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(...conds));
    };
    return tenantId ? withTenantContext(this.db, tenantId, run) : run(this.db);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  async appendEvent(tenantId: string, event: BrainThreadEvent): Promise<void> {
    const now = new Date(event.createdAt);
    const { id, threadId, kind, actorId, visibility, parentEventId, createdAt, ...rest } =
      event;
    // All writes for one event run inside ONE per-tenant transaction so they
    // share a connection carrying the tenant GUC (RLS FORCE). This also makes
    // the event insert + thread-aggregate update atomic (previously they were
    // separate statements reconciled by a nightly job — now consistent).
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(threadEvents).values({
        id,
        tenantId,
        threadId,
        kind,
        actorId,
        visibilityScope: visibility.scope,
        visibilityAuthorActorId: visibility.authorActorId,
        visibilityInitiatingUserId: visibility.initiatingUserId ?? null,
        visibilityTeamId: visibility.teamId ?? null,
        visibilityRationale: visibility.rationale ?? null,
        parentEventId: parentEventId ?? null,
        payload: rest,
        createdAt: now,
      });

      // Update thread aggregates on the same connection/transaction.
      await tx
        .update(threads)
        .set({
          updatedAt: now,
          lastEventAt: now,
        })
        .where(eq(threads.id, threadId));

      // If handoff_out, mirror into handoff_packets for fast audit queries.
      if (kind === 'handoff_out') {
        const packet = (rest as { packet?: Record<string, unknown> }).packet;
        if (packet) {
          await tx.insert(handoffPackets).values({
            id: String(packet.id),
            tenantId,
            threadId,
            eventId: id,
            sourcePersonaId: String(packet.sourcePersonaId),
            targetPersonaId: String(packet.targetPersonaId),
            objective: String(packet.objective),
            outputFormat: String(packet.outputFormat),
            contextSummary: String(packet.contextSummary),
            latestUserMessage:
              (packet.latestUserMessage as string | undefined) ?? null,
            relevantEntities:
              (packet.relevantEntities as unknown[]) ?? [],
            priorDecisions: (packet.priorDecisions as unknown[]) ?? [],
            constraints: (packet.constraints as unknown[]) ?? [],
            allowedTools: (packet.allowedTools as string[]) ?? [],
            visibilityScope: String(
              (packet.visibility as { scope: string }).scope
            ) as 'private' | 'team' | 'management' | 'public',
            tokensSoFar: Number(packet.tokensSoFar ?? 0),
            tokenBudget: Number(packet.tokenBudget ?? 2048),
            accepted: false,
            acceptedAt: null,
            acceptedBy: null,
            createdAt: now,
          });
        }
      }
    });
  }

  async listEvents(threadId: string, tenantId?: string): Promise<BrainThreadEvent[]> {
    // threadEvents is tenant-scoped via thread FK. We additionally
    // filter on tenantId directly so the query never returns another
    // tenant's events even if a caller forgets to gate the thread
    // lookup first. When tenantId is supplied the read is pinned inside a
    // per-tenant transaction so the RLS GUC is bound on its connection.
    const run = async (db: DatabaseClient): Promise<BrainThreadEvent[]> => {
    const conds = [eq(threadEvents.threadId, threadId)];
    if (tenantId) conds.push(eq(threadEvents.tenantId, tenantId));
    const rows = await db
      .select()
      .from(threadEvents)
      .where(and(...conds))
      .orderBy(threadEvents.createdAt);
    // With `exactOptionalPropertyTypes`, optional fields must either be
    // omitted or carry a concrete value. Spread the nullable columns
    // conditionally so we never assign explicit `undefined`.
    return rows.map((r): BrainThreadEvent => ({
      id: r.id,
      threadId: r.threadId,
      kind: r.kind as BrainThreadEvent['kind'],
      actorId: r.actorId,
      visibility: {
        scope: r.visibilityScope as 'private' | 'team' | 'management' | 'public',
        authorActorId: r.visibilityAuthorActorId,
        ...(r.visibilityInitiatingUserId != null
          ? { initiatingUserId: r.visibilityInitiatingUserId }
          : {}),
        ...(r.visibilityTeamId != null ? { teamId: r.visibilityTeamId } : {}),
        ...(r.visibilityRationale != null
          ? { rationale: r.visibilityRationale }
          : {}),
      },
      ...(r.parentEventId != null ? { parentEventId: r.parentEventId } : {}),
      createdAt: (r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : String(r.createdAt)),
      ...(r.payload as Record<string, unknown>),
    }));
    };
    return tenantId ? withTenantContext(this.db, tenantId, run) : run(this.db);
  }
}

function rowToThread(r: typeof threads.$inferSelect): BrainThread {
  // With `exactOptionalPropertyTypes`, an optional property must either be
  // omitted entirely or carry a concrete value — explicit `undefined` is
  // rejected. Use conditional spreads so nullable columns either inject the
  // string or simply omit the key.
  return {
    id: r.id,
    tenantId: r.tenantId,
    initiatingUserId: r.initiatingUserId,
    primaryPersonaId: r.primaryPersonaId,
    ...(r.teamId != null ? { teamId: r.teamId } : {}),
    ...(r.employeeId != null ? { employeeId: r.employeeId } : {}),
    title: r.title,
    status: r.status as BrainThread['status'],
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  };
}