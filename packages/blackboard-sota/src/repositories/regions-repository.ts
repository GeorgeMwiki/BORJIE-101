/**
 * Regions repository — in-memory + SQL adapters.
 *
 * Wave BLACKBOARD-CORE. Both adapters implement `RegionsRepository`
 * from `../types.ts`. The in-memory variant powers tests and the
 * default in-process runtime; the SQL variant targets the
 * `blackboard_regions` table from migration 0073.
 *
 * Audit-chain integration: every region row carries `prev_hash` /
 * `audit_hash`. The in-memory adapter chains *every* region row in
 * insertion order — a global tenant-scoped chain. Per-region chains
 * (posts + summaries) chain off `region.audit_hash` at creation.
 *
 * @module @borjie/blackboard-sota/repositories/regions-repository
 */

import { GENESIS_HASH } from '@borjie/audit-hash-chain';
import { computeBlackboardHash } from '../audit/hash-chain.js';
import {
  type OpenRegionInput,
  type Region,
  type RegionKind,
  type RegionStatus,
  type RegionsRepository,
} from '../types.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DuplicateRegionError extends Error {
  constructor(readonly tenantId: string, readonly id: string) {
    super(`Duplicate region: tenant=${tenantId} id=${id}`);
    this.name = 'DuplicateRegionError';
  }
}

export class UnknownRegionError extends Error {
  constructor(readonly tenantId: string, readonly id: string) {
    super(`Unknown region: tenant=${tenantId} id=${id}`);
    this.name = 'UnknownRegionError';
  }
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export interface InMemoryRegionsRepositoryDeps {
  readonly now?: () => Date;
}

export function createInMemoryRegionsRepository(
  deps: InMemoryRegionsRepositoryDeps = {},
): RegionsRepository {
  const now = deps.now ?? (() => new Date());
  // (tenantId, id) -> Region
  const byKey = new Map<string, Region>();
  // tenant -> last audit hash (tenant-scoped chain on region rows)
  const lastHashByTenant = new Map<string, string>();

  function key(tenantId: string, id: string): string {
    return `${tenantId}::${id}`;
  }

  return {
    async open(input: OpenRegionInput) {
      const k = key(input.tenantId, input.id);
      if (byKey.has(k)) {
        throw new DuplicateRegionError(input.tenantId, input.id);
      }
      const openedAt = now();
      const prev = lastHashByTenant.get(input.tenantId) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'region:open',
          id: input.id,
          tenantId: input.tenantId,
          regionKind: input.regionKind,
          openedAt: openedAt.toISOString(),
        },
        prev,
      );
      const row: Region = Object.freeze({
        id: input.id,
        tenantId: input.tenantId,
        scopeId: input.scopeId ?? null,
        regionKind: input.regionKind,
        status: 'open' as RegionStatus,
        openedAt,
        closedAt: null,
        prevHash: prev,
        auditHash,
      });
      byKey.set(k, row);
      lastHashByTenant.set(input.tenantId, auditHash);
      return row;
    },

    async transition(tenantId, id, next) {
      const k = key(tenantId, id);
      const existing = byKey.get(k);
      if (existing === undefined) throw new UnknownRegionError(tenantId, id);
      const t = now();
      const prev = lastHashByTenant.get(tenantId) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'region:transition',
          id,
          tenantId,
          prevStatus: existing.status,
          nextStatus: next,
          at: t.toISOString(),
        },
        prev,
      );
      const updated: Region = Object.freeze({
        ...existing,
        status: next,
        closedAt: next === 'closed' ? t : existing.closedAt,
        prevHash: prev,
        auditHash,
      });
      byKey.set(k, updated);
      lastHashByTenant.set(tenantId, auditHash);
      return updated;
    },

    async get(tenantId, id) {
      const row = byKey.get(key(tenantId, id));
      return row ?? null;
    },

    async listByTenant(
      tenantId,
      filter?: { readonly status?: RegionStatus; readonly regionKind?: RegionKind },
    ) {
      const out: Region[] = [];
      for (const r of byKey.values()) {
        if (r.tenantId !== tenantId) continue;
        if (filter?.status !== undefined && r.status !== filter.status) continue;
        if (
          filter?.regionKind !== undefined &&
          r.regionKind !== filter.regionKind
        ) {
          continue;
        }
        out.push(r);
      }
      out.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      return Object.freeze([...out]);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — Drizzle-compatible driver port
// ---------------------------------------------------------------------------

/**
 * Minimal SQL driver port the SQL adapter depends on. Implementations
 * adapt Drizzle, pg, or any other client. The SQL adapter assumes the
 * driver already binds the `app.tenant_id` GUC so RLS auto-scopes.
 */
export interface RegionsSqlDriver {
  insertRow(row: {
    readonly id: string;
    readonly tenantId: string;
    readonly scopeId: string | null;
    readonly regionKind: RegionKind;
    readonly status: RegionStatus;
    readonly openedAt: Date;
    readonly closedAt: Date | null;
    readonly prevHash: string;
    readonly auditHash: string;
  }): Promise<void>;
  updateStatus(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly status: RegionStatus;
    readonly closedAt: Date | null;
    readonly prevHash: string;
    readonly auditHash: string;
  }): Promise<void>;
  selectById(tenantId: string, id: string): Promise<Region | null>;
  selectByTenant(
    tenantId: string,
    filter?: { readonly status?: RegionStatus; readonly regionKind?: RegionKind },
  ): Promise<ReadonlyArray<Region>>;
  selectLastAuditHash(tenantId: string): Promise<string | null>;
}

export function createSqlRegionsRepository(
  driver: RegionsSqlDriver,
  deps: { readonly now?: () => Date } = {},
): RegionsRepository {
  const now = deps.now ?? (() => new Date());
  return {
    async open(input) {
      const existing = await driver.selectById(input.tenantId, input.id);
      if (existing !== null) {
        throw new DuplicateRegionError(input.tenantId, input.id);
      }
      const openedAt = now();
      const prev = (await driver.selectLastAuditHash(input.tenantId)) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'region:open',
          id: input.id,
          tenantId: input.tenantId,
          regionKind: input.regionKind,
          openedAt: openedAt.toISOString(),
        },
        prev,
      );
      const row: Region = Object.freeze({
        id: input.id,
        tenantId: input.tenantId,
        scopeId: input.scopeId ?? null,
        regionKind: input.regionKind,
        status: 'open' as RegionStatus,
        openedAt,
        closedAt: null,
        prevHash: prev,
        auditHash,
      });
      await driver.insertRow(row);
      return row;
    },
    async transition(tenantId, id, next) {
      const existing = await driver.selectById(tenantId, id);
      if (existing === null) throw new UnknownRegionError(tenantId, id);
      const t = now();
      const prev = (await driver.selectLastAuditHash(tenantId)) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'region:transition',
          id,
          tenantId,
          prevStatus: existing.status,
          nextStatus: next,
          at: t.toISOString(),
        },
        prev,
      );
      const closedAt = next === 'closed' ? t : existing.closedAt;
      await driver.updateStatus({
        tenantId,
        id,
        status: next,
        closedAt,
        prevHash: prev,
        auditHash,
      });
      return Object.freeze({
        ...existing,
        status: next,
        closedAt,
        prevHash: prev,
        auditHash,
      });
    },
    async get(tenantId, id) {
      return driver.selectById(tenantId, id);
    },
    async listByTenant(tenantId, filter) {
      return driver.selectByTenant(tenantId, filter);
    },
  };
}
