/**
 * Assignment lifecycle — assign / revoke / pause / resume / extend.
 *
 * Every mutation writes one Assignment row AND one AssignmentEvent row
 * (append-only). Reads always go through the repository so the in-memory
 * adapter and the future Drizzle adapter are interchangeable.
 *
 * Idempotency contract:
 *   - `assignUser` is idempotent on `(tenantId, assigneeUserId, scope,
 *     scopeRefs[*], capabilities[*])` — re-calling with the same tuple
 *     returns the existing assignment instead of creating a duplicate.
 *   - All other mutations are idempotent on the assignment id; calling
 *     `revoke` on an already-revoked assignment is a no-op (no second
 *     event is written, no error thrown).
 *
 * Immutability:
 *   Assignment objects are frozen on insert and never mutated. Every
 *   change creates a NEW object via spread + Object.freeze.
 *
 * Concurrency model:
 *   In-process: serialised per assignment id via the per-id lock map.
 *   In production: the api-gateway wires a Postgres advisory-lock
 *   wrapper around the same lifecycle functions.
 */

import type {
  Assignment,
  AssignmentEvent,
  AssignmentEventKind,
  AssignmentEventRepository,
  AssignmentRepository,
  AssignmentStatus,
  AssignUserRequest,
  Capability,
  ScopeKind,
} from '../types.js';
import type { IdGen } from '../internal/id.js';

export interface LifecycleDeps {
  readonly assignmentRepository: AssignmentRepository;
  readonly eventRepository: AssignmentEventRepository;
  readonly idGen: IdGen;
  /** Provide the wall clock for testability. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

export interface LifecycleManager {
  assignUser(input: AssignUserRequest): Promise<Assignment>;
  bulkAssign(
    inputs: ReadonlyArray<AssignUserRequest>,
  ): Promise<ReadonlyArray<Assignment>>;
  revokeAssignment(
    assignmentId: string,
    revokedByUserId: string,
    reason?: string,
  ): Promise<Assignment>;
  pauseAssignment(
    assignmentId: string,
    pausedByUserId: string,
    reason?: string,
  ): Promise<Assignment>;
  resumeAssignment(
    assignmentId: string,
    resumedByUserId: string,
  ): Promise<Assignment>;
  extendAssignment(
    assignmentId: string,
    newEndsAt: Date | null,
    actorUserId: string,
  ): Promise<Assignment>;
  addCapability(
    assignmentId: string,
    capability: Capability,
    actorUserId: string,
  ): Promise<Assignment>;
  removeCapability(
    assignmentId: string,
    capability: Capability,
    actorUserId: string,
  ): Promise<Assignment>;
  addScopeRef(
    assignmentId: string,
    scopeRef: string,
    actorUserId: string,
  ): Promise<Assignment>;
  removeScopeRef(
    assignmentId: string,
    scopeRef: string,
    actorUserId: string,
  ): Promise<Assignment>;
}

export function createLifecycleManager(deps: LifecycleDeps): LifecycleManager {
  const now = deps.now ?? (() => new Date());
  // Per-id mutex so concurrent mutations on the SAME assignment serialise.
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(
    id: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(id, previous.then(() => current));
    try {
      await previous;
      return await fn();
    } finally {
      release();
      // Clean up only the latest entry — leave any further chained
      // calls untouched.
      if (locks.get(id) && (await Promise.resolve(locks.get(id))) === undefined) {
        locks.delete(id);
      }
    }
  }

  async function writeEvent(
    assignment: Assignment,
    kind: AssignmentEventKind,
    actorUserId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: AssignmentEvent = Object.freeze({
      id: deps.idGen.next('asnev'),
      assignmentId: assignment.id,
      tenantId: assignment.tenantId,
      kind,
      actorUserId,
      payload: Object.freeze({ ...payload }),
      occurredAt: now(),
    });
    await deps.eventRepository.insert(event);
  }

  function freeze(a: Assignment): Assignment {
    return Object.freeze({
      ...a,
      scopeRefs: Object.freeze([...a.scopeRefs]) as ReadonlyArray<string>,
      capabilities: Object.freeze([...a.capabilities]) as ReadonlyArray<Capability>,
      metadata: Object.freeze({ ...a.metadata }) as Readonly<Record<string, unknown>>,
    });
  }

  async function findIdempotentMatch(
    tenantId: string,
    userId: string,
    scope: ScopeKind,
    scopeRefs: ReadonlyArray<string>,
    capabilities: ReadonlyArray<Capability>,
  ): Promise<Assignment | null> {
    const existing = await deps.assignmentRepository.findByAssignee(
      tenantId,
      userId,
    );
    const wantedRefs = new Set(scopeRefs);
    const wantedCaps = new Set(capabilities);
    for (const a of existing) {
      if (a.status !== 'active') continue;
      if (a.scope !== scope) continue;
      if (a.scopeRefs.length !== wantedRefs.size) continue;
      if (a.capabilities.length !== wantedCaps.size) continue;
      const refsMatch = a.scopeRefs.every((r) => wantedRefs.has(r));
      const capsMatch = a.capabilities.every((c) => wantedCaps.has(c));
      if (refsMatch && capsMatch) return a;
    }
    return null;
  }

  async function loadOrThrow(id: string): Promise<Assignment> {
    // nosemgrep: missing-tenant-id-arg reason: assignments are globally-unique by id; tenant is on the returned `Assignment` record and callers verify scope.
    const a = await deps.assignmentRepository.findById(id);
    if (!a) throw new Error(`assignment_not_found: ${id}`);
    return a;
  }

  async function transition(
    id: string,
    nextStatus: AssignmentStatus,
    kind: AssignmentEventKind,
    actorUserId: string,
    extra: Record<string, unknown> = {},
  ): Promise<Assignment> {
    return withLock(id, async () => {
      const current = await loadOrThrow(id);
      if (current.status === nextStatus) {
        // No-op idempotent path. Don't write a second event.
        return current;
      }
      const updated = freeze({
        ...current,
        status: nextStatus,
        updatedAt: now(),
      });
      await deps.assignmentRepository.update(updated);
      await writeEvent(updated, kind, actorUserId, extra);
      return updated;
    });
  }

  return {
    async assignUser(input) {
      const scopeRefs = [...input.scopeRefs];
      const capabilities = [...input.capabilities];
      const existing = await findIdempotentMatch(
        input.tenantId,
        input.userId,
        input.scope,
        scopeRefs,
        capabilities,
      );
      if (existing) return existing;

      const id = deps.idGen.next('asn');
      const t = now();
      const assignment: Assignment = freeze({
        id,
        tenantId: input.tenantId,
        assigneeUserId: input.userId,
        scope: input.scope,
        scopeRefs,
        capabilities,
        startsAt: input.startsAt ?? t,
        endsAt: input.endsAt ?? null,
        assignedByUserId: input.assignedBy,
        status: 'active' as AssignmentStatus,
        reason: input.reason ?? null,
        metadata: { ...(input.metadata ?? {}) },
        createdAt: t,
        updatedAt: t,
      });
      await deps.assignmentRepository.insert(assignment);
      await writeEvent(assignment, 'created', input.assignedBy, {
        scope: input.scope,
        scopeRefs,
        capabilities,
      });
      return assignment;
    },

    async bulkAssign(inputs) {
      const out: Assignment[] = [];
      for (const input of inputs) {
        // Sequential — each call dedupes against rows committed earlier
        // in the batch. Parallelism would re-introduce dupes.
        out.push(await this.assignUser(input));
      }
      return Object.freeze(out);
    },

    async revokeAssignment(assignmentId, actorUserId, reason) {
      return transition(
        assignmentId,
        'revoked' as AssignmentStatus,
        'revoked',
        actorUserId,
        reason ? { reason } : {},
      );
    },

    async pauseAssignment(assignmentId, actorUserId, reason) {
      return transition(
        assignmentId,
        'paused' as AssignmentStatus,
        'paused',
        actorUserId,
        reason ? { reason } : {},
      );
    },

    async resumeAssignment(assignmentId, actorUserId) {
      return transition(
        assignmentId,
        'active' as AssignmentStatus,
        'resumed',
        actorUserId,
      );
    },

    async extendAssignment(assignmentId, newEndsAt, actorUserId) {
      return withLock(assignmentId, async () => {
        const current = await loadOrThrow(assignmentId);
        if (
          (current.endsAt?.getTime() ?? null) === (newEndsAt?.getTime() ?? null)
        ) {
          return current;
        }
        const updated = freeze({
          ...current,
          endsAt: newEndsAt,
          updatedAt: now(),
        });
        await deps.assignmentRepository.update(updated);
        await writeEvent(updated, 'extended', actorUserId, {
          newEndsAt: newEndsAt?.toISOString() ?? null,
          previousEndsAt: current.endsAt?.toISOString() ?? null,
        });
        return updated;
      });
    },

    async addCapability(assignmentId, capability, actorUserId) {
      return withLock(assignmentId, async () => {
        const current = await loadOrThrow(assignmentId);
        if (current.capabilities.includes(capability)) return current;
        const updated = freeze({
          ...current,
          capabilities: [...current.capabilities, capability],
          updatedAt: now(),
        });
        await deps.assignmentRepository.update(updated);
        await writeEvent(updated, 'capability_added', actorUserId, {
          capability,
        });
        return updated;
      });
    },

    async removeCapability(assignmentId, capability, actorUserId) {
      return withLock(assignmentId, async () => {
        const current = await loadOrThrow(assignmentId);
        if (!current.capabilities.includes(capability)) return current;
        const updated = freeze({
          ...current,
          capabilities: current.capabilities.filter((c) => c !== capability),
          updatedAt: now(),
        });
        await deps.assignmentRepository.update(updated);
        await writeEvent(updated, 'capability_removed', actorUserId, {
          capability,
        });
        return updated;
      });
    },

    async addScopeRef(assignmentId, scopeRef, actorUserId) {
      return withLock(assignmentId, async () => {
        const current = await loadOrThrow(assignmentId);
        if (current.scopeRefs.includes(scopeRef)) return current;
        const updated = freeze({
          ...current,
          scopeRefs: [...current.scopeRefs, scopeRef],
          updatedAt: now(),
        });
        await deps.assignmentRepository.update(updated);
        await writeEvent(updated, 'scope_ref_added', actorUserId, {
          scopeRef,
        });
        return updated;
      });
    },

    async removeScopeRef(assignmentId, scopeRef, actorUserId) {
      return withLock(assignmentId, async () => {
        const current = await loadOrThrow(assignmentId);
        if (!current.scopeRefs.includes(scopeRef)) return current;
        const updated = freeze({
          ...current,
          scopeRefs: current.scopeRefs.filter((r) => r !== scopeRef),
          updatedAt: now(),
        });
        await deps.assignmentRepository.update(updated);
        await writeEvent(updated, 'scope_ref_removed', actorUserId, {
          scopeRef,
        });
        return updated;
      });
    },
  };
}
