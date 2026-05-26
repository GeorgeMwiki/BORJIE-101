/**
 * Invocation repository — port + in-memory + SQL adapters.
 *
 * The worker reads invocations over a rolling window per capability;
 * services record invocations as they happen. The in-memory adapter
 * powers tests; the SQL adapter wires to drizzle at composition root.
 *
 * @module @borjie/capability-catalogue/repositories/invocation-repository
 */

import type { Invocation } from '../types.js';

export interface InvocationRepository {
  insert(row: Invocation): Promise<void>;
  /**
   * List invocations for a capability between `from` (inclusive) and
   * `to` (exclusive). Both are ISO 8601 timestamps.
   */
  listByCapabilityInWindow(args: {
    readonly tenantId: string;
    readonly capabilityId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<ReadonlyArray<Invocation>>;
}

export function createInMemoryInvocationRepository(): InvocationRepository {
  const rows: Array<Invocation> = [];

  return {
    async insert(row) {
      rows.push(Object.freeze({ ...row }));
    },
    async listByCapabilityInWindow({ tenantId, capabilityId, from, to }) {
      const out: Array<Invocation> = [];
      for (const r of rows) {
        if (
          r.tenantId === tenantId &&
          r.capabilityId === capabilityId &&
          r.invokedAt >= from &&
          r.invokedAt < to
        ) {
          out.push(r);
        }
      }
      return Object.freeze(out);
    },
  };
}

export interface SqlInvocationDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function rowToInvocation(r: Record<string, unknown>): Invocation {
  const ts = r['invoked_at'];
  return Object.freeze({
    id: r['id'] as string,
    tenantId: r['tenant_id'] as string,
    capabilityId: r['capability_id'] as string,
    invokedAt: ts instanceof Date ? ts.toISOString() : (ts as string),
    latencyMs: Number(r['latency_ms'] ?? 0),
    success: Boolean(r['success']),
    errorKind: (r['error_kind'] as string | null) ?? null,
    costUsdCents: Number(r['cost_usd_cents'] ?? 0),
    auditHash: r['audit_hash'] as string,
  });
}

export function createSqlInvocationRepository(args: {
  readonly driver: SqlInvocationDriver;
}): InvocationRepository {
  return {
    async insert(row) {
      await args.driver.query({
        text: `
          INSERT INTO capability_invocations
            (id, tenant_id, capability_id, invoked_at, latency_ms, success,
             error_kind, cost_usd_cents, audit_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        values: [
          row.id,
          row.tenantId,
          row.capabilityId,
          row.invokedAt,
          row.latencyMs,
          row.success,
          row.errorKind,
          row.costUsdCents,
          row.auditHash,
        ],
      });
    },
    async listByCapabilityInWindow({ tenantId, capabilityId, from, to }) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, capability_id, invoked_at, latency_ms, success,
                 error_kind, cost_usd_cents, audit_hash
            FROM capability_invocations
           WHERE tenant_id = $1
             AND capability_id = $2
             AND invoked_at >= $3
             AND invoked_at < $4
           ORDER BY invoked_at ASC
        `,
        values: [tenantId, capabilityId, from, to],
      });
      return Object.freeze(rows.map(rowToInvocation));
    },
  };
}
