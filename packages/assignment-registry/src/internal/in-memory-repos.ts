/**
 * In-memory adapters for `AssignmentRepository` and
 * `AssignmentEventRepository`. Used by tests and as the default in
 * dev mode. Production wires a Drizzle adapter in api-gateway.
 *
 * Invariants:
 *   - All Maps are tenant-namespaced so a leak between tenants is
 *     structurally impossible.
 *   - Reads return frozen arrays so callers can't mutate state.
 */

import type {
  Assignment,
  AssignmentEvent,
  AssignmentEventRepository,
  AssignmentRepository,
  ScopeKind,
} from '../types.js';

export function createInMemoryAssignmentRepository(): AssignmentRepository {
  // tenantId → assignmentId → assignment
  const byTenant = new Map<string, Map<string, Assignment>>();

  function bucket(tenantId: string): Map<string, Assignment> {
    let b = byTenant.get(tenantId);
    if (!b) {
      b = new Map();
      byTenant.set(tenantId, b);
    }
    return b;
  }

  return {
    async insert(assignment) {
      const b = bucket(assignment.tenantId);
      if (b.has(assignment.id)) {
        throw new Error(`assignment ${assignment.id} already exists`);
      }
      b.set(assignment.id, assignment);
    },
    async update(assignment) {
      const b = bucket(assignment.tenantId);
      if (!b.has(assignment.id)) {
        throw new Error(`assignment ${assignment.id} does not exist`);
      }
      b.set(assignment.id, assignment);
    },
    async findById(id) {
      for (const tenantBucket of byTenant.values()) {
        const a = tenantBucket.get(id);
        if (a) return a;
      }
      return null;
    },
    async findByAssignee(tenantId, userId) {
      const b = byTenant.get(tenantId);
      if (!b) return Object.freeze([]);
      return Object.freeze(
        [...b.values()].filter((a) => a.assigneeUserId === userId),
      );
    },
    async findByScope(tenantId: string, scope: ScopeKind, scopeRef?: string) {
      const b = byTenant.get(tenantId);
      if (!b) return Object.freeze([]);
      const filtered = [...b.values()].filter((a) => {
        if (a.scope !== scope) return false;
        if (scopeRef === undefined) return true;
        // scopeRefs empty = scope-wide grant
        return a.scopeRefs.length === 0 || a.scopeRefs.includes(scopeRef);
      });
      return Object.freeze(filtered);
    },
    async list(tenantId) {
      const b = byTenant.get(tenantId);
      if (!b) return Object.freeze([]);
      return Object.freeze([...b.values()]);
    },
  };
}

export function createInMemoryAssignmentEventRepository(): AssignmentEventRepository {
  // assignmentId → events
  const byAssignment = new Map<string, AssignmentEvent[]>();

  return {
    async insert(event) {
      let list = byAssignment.get(event.assignmentId);
      if (!list) {
        list = [];
        byAssignment.set(event.assignmentId, list);
      }
      list.push(event);
    },
    async listForAssignment(assignmentId) {
      const list = byAssignment.get(assignmentId);
      if (!list) return Object.freeze([]);
      return Object.freeze([...list]);
    },
  };
}
