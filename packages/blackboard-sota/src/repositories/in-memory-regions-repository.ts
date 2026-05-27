/**
 * In-memory `RegionsRepository` adapter.
 *
 * Wave BLACKBOARD-CORE. Pure-memory adapter for tests + dev. Production
 * wires a Drizzle-backed adapter on the database package against
 * `blackboard_regions` (migration 0073).
 *
 * Stamps `audit_hash` + `prev_hash` on every write. The first region a
 * tenant opens uses `GENESIS_HASH` as prev; subsequent opens chain
 * into the tenant's region-creation chain (not the per-region chain
 * for posts — that one is independent per region).
 */

import {
  type OpenRegionInput,
  type Region,
  type RegionKind,
  type RegionStatus,
  type RegionsRepository,
} from '../types.js';
import { computeBlackboardHash, GENESIS_HASH } from '../audit/hash-chain.js';

interface InMemoryRegionsRepositoryDeps {
  readonly now?: () => Date;
}

export function createInMemoryRegionsRepository(
  deps: InMemoryRegionsRepositoryDeps = {},
): RegionsRepository {
  const now = deps.now ?? (() => new Date());
  // Keyed by `${tenantId}::${id}`.
  const rows = new Map<string, Region>();
  // Per-tenant tail hash for the region-open chain.
  const tenantTails = new Map<string, string>();

  function key(tenantId: string, id: string): string {
    return `${tenantId}::${id}`;
  }

  return {
    async open(input: OpenRegionInput): Promise<Region> {
      const k = key(input.tenantId, input.id);
      if (rows.has(k)) {
        const existing = rows.get(k);
        if (existing !== undefined) return existing;
      }
      const t = now();
      const prevHash = tenantTails.get(input.tenantId) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          op: 'open',
          tenantId: input.tenantId,
          id: input.id,
          regionKind: input.regionKind,
          openedAtIso: t.toISOString(),
        },
        prevHash,
      );
      const row: Region = Object.freeze({
        id: input.id,
        tenantId: input.tenantId,
        scopeId: input.scopeId ?? null,
        regionKind: input.regionKind,
        status: 'open' as RegionStatus,
        openedAt: t,
        closedAt: null,
        prevHash,
        auditHash,
      });
      rows.set(k, row);
      tenantTails.set(input.tenantId, auditHash);
      return row;
    },

    async transition(
      tenantId: string,
      id: string,
      next: RegionStatus,
    ): Promise<Region> {
      const k = key(tenantId, id);
      const current = rows.get(k);
      if (current === undefined) {
        throw new Error(`Region not found: tenant=${tenantId} id=${id}`);
      }
      const t = now();
      const prevHash = current.auditHash;
      const auditHash = computeBlackboardHash(
        {
          op: 'transition',
          tenantId,
          id,
          fromStatus: current.status,
          toStatus: next,
          atIso: t.toISOString(),
        },
        prevHash,
      );
      const closedAt = next === 'closed' ? t : current.closedAt;
      const updated: Region = Object.freeze({
        ...current,
        status: next,
        closedAt,
        prevHash,
        auditHash,
      });
      rows.set(k, updated);
      return updated;
    },

    async get(tenantId, id) {
      return rows.get(key(tenantId, id)) ?? null;
    },

    async listByTenant(tenantId, filter) {
      const matches: Region[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (filter?.status !== undefined && row.status !== filter.status) continue;
        if (
          filter?.regionKind !== undefined &&
          row.regionKind !== filter.regionKind
        ) {
          continue;
        }
        matches.push(row);
      }
      return matches
        .slice()
        .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    },
  };
}

export type { Region, RegionKind };
