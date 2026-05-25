/**
 * In-memory adapters for `WorkflowRunRepository`,
 * `WorkflowRunEventRepository`, `AuditChainRepository`. Used by tests
 * + dev. Production wires Drizzle adapters in api-gateway.
 */

import type {
  AuditChainEntry,
  AuditChainRepository,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunEventRepository,
  WorkflowRunRepository,
} from '../types.js';

export function createInMemoryRunRepository(): WorkflowRunRepository {
  const byTenant = new Map<string, Map<string, WorkflowRun>>();

  function bucket(tenantId: string): Map<string, WorkflowRun> {
    let b = byTenant.get(tenantId);
    if (!b) {
      b = new Map();
      byTenant.set(tenantId, b);
    }
    return b;
  }

  return {
    async insert(run) {
      const b = bucket(run.tenantId);
      if (b.has(run.id)) throw new Error(`run_exists: ${run.id}`);
      b.set(run.id, run);
    },
    async update(run) {
      const b = bucket(run.tenantId);
      if (!b.has(run.id)) throw new Error(`run_not_found: ${run.id}`);
      b.set(run.id, run);
    },
    async findById(id) {
      for (const t of byTenant.values()) {
        const r = t.get(id);
        if (r) return r;
      }
      return null;
    },
    async listForUser(tenantId, userId) {
      const b = byTenant.get(tenantId);
      if (!b) return Object.freeze([]);
      return Object.freeze(
        [...b.values()].filter((r) => r.initiatedByUserId === userId),
      );
    },
    async listReviewQueue(tenantId) {
      const b = byTenant.get(tenantId);
      if (!b) return Object.freeze([]);
      return Object.freeze(
        [...b.values()].filter((r) => r.state === 'in_review'),
      );
    },
    async listApprovalQueue(tenantId) {
      const b = byTenant.get(tenantId);
      if (!b) return Object.freeze([]);
      return Object.freeze(
        [...b.values()].filter((r) => r.state === 'in_approval'),
      );
    },
    async list(tenantId) {
      const b = byTenant.get(tenantId);
      if (!b) return Object.freeze([]);
      return Object.freeze([...b.values()]);
    },
  };
}

export function createInMemoryRunEventRepository(): WorkflowRunEventRepository {
  const byRun = new Map<string, WorkflowRunEvent[]>();
  return {
    async insert(event) {
      let list = byRun.get(event.runId);
      if (!list) {
        list = [];
        byRun.set(event.runId, list);
      }
      list.push(event);
    },
    async listForRun(runId) {
      const list = byRun.get(runId);
      if (!list) return Object.freeze([]);
      return Object.freeze([...list]);
    },
  };
}

export function createInMemoryAuditChainRepository(): AuditChainRepository {
  const byTenant = new Map<string, AuditChainEntry[]>();
  return {
    async insert(entry) {
      let list = byTenant.get(entry.tenantId);
      if (!list) {
        list = [];
        byTenant.set(entry.tenantId, list);
      }
      list.push(entry);
    },
    async listForRun(runId) {
      const out: AuditChainEntry[] = [];
      for (const list of byTenant.values()) {
        for (const e of list) if (e.runId === runId) out.push(e);
      }
      out.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
      return Object.freeze(out);
    },
    async latestHashForTenant(tenantId) {
      const list = byTenant.get(tenantId);
      if (!list || list.length === 0) return 'GENESIS';
      return list[list.length - 1]!.currentHash;
    },
  };
}
