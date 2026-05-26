/**
 * Capability repository — port + in-memory + SQL adapters.
 *
 * The repository is a thin persistence-layer wrapper around the
 * registry's view of the catalogue. The registry already exposes the
 * full author/list/transition contract; the repository exists so
 * downstream code can hold a *narrower* read-only view (`listAll`)
 * without depending on the full registry surface.
 *
 * @module @borjie/capability-catalogue/repositories/capability-repository
 */

import type { Capability } from '../types.js';

export interface CapabilityRepository {
  /** All capabilities for a tenant (including seed visibility). */
  listAll(tenantId: string): Promise<ReadonlyArray<Capability>>;
  findById(id: string): Promise<Capability | null>;
}

export function createInMemoryCapabilityRepository(args: {
  readonly rows: ReadonlyArray<Capability>;
}): CapabilityRepository {
  // Defensive copy so callers cannot mutate our view.
  const frozen = Object.freeze([...args.rows]);
  const byId = new Map<string, Capability>();
  for (const r of frozen) byId.set(r.id, r);

  return {
    async listAll(tenantId) {
      const out: Array<Capability> = [];
      for (const r of frozen) {
        if (r.tenantId === tenantId || r.tenantId === '__seed__') {
          out.push(r);
        }
      }
      return Object.freeze(out);
    },
    async findById(id) {
      return byId.get(id) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — wired by the worker against drizzle at composition root.
// ---------------------------------------------------------------------------

/**
 * Minimal SQL port shape — the worker injects a driver that fulfils
 * this interface. We keep it untyped at the package boundary so the
 * package itself does not depend on drizzle.
 */
export interface SqlCapabilityDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function rowToCapability(r: Record<string, unknown>): Capability {
  return Object.freeze({
    id: r['id'] as string,
    tenantId: r['tenant_id'] as string,
    name: r['name'] as string,
    version: r['version'] as string,
    kind: r['kind'] as Capability['kind'],
    owner: r['owner'] as string,
    lifecycleState: r['lifecycle_state'] as Capability['lifecycleState'],
    dependencies: Object.freeze([...((r['dependencies'] as string[]) ?? [])]),
    contract: r['contract'] as Capability['contract'],
    provenanceClass: r['provenance_class'] as Capability['provenanceClass'],
    createdAt: (r['created_at'] as Date | string) instanceof Date
      ? (r['created_at'] as Date).toISOString()
      : (r['created_at'] as string),
    auditHash: r['audit_hash'] as string,
    prevHash: (r['prev_hash'] as string | null) ?? null,
  });
}

export function createSqlCapabilityRepository(args: {
  readonly driver: SqlCapabilityDriver;
}): CapabilityRepository {
  return {
    async listAll(tenantId) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, name, version, kind, owner, lifecycle_state,
                 dependencies, contract, provenance_class, created_at,
                 audit_hash, prev_hash
            FROM capabilities
           WHERE tenant_id = $1 OR tenant_id = '__seed__'
        `,
        values: [tenantId],
      });
      return Object.freeze(rows.map(rowToCapability));
    },
    async findById(id) {
      const rows = await args.driver.query({
        text: `
          SELECT id, tenant_id, name, version, kind, owner, lifecycle_state,
                 dependencies, contract, provenance_class, created_at,
                 audit_hash, prev_hash
            FROM capabilities
           WHERE id = $1
           LIMIT 1
        `,
        values: [id],
      });
      const row = rows[0];
      return row ? rowToCapability(row) : null;
    },
  };
}
