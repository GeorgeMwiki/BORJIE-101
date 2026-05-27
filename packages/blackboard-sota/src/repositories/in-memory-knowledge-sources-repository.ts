/**
 * In-memory `KnowledgeSourcesRepository` adapter.
 *
 * Wave BLACKBOARD-CORE. Pure-memory adapter for tests + dev.
 * Enforces the UNIQUE (tenant_id, ks_kind, ks_name) constraint
 * declared by migration 0073 by collapsing repeated registers
 * idempotently — the second `register` call with the same triple
 * returns the existing row.
 */

import { randomUUID } from 'node:crypto';
import {
  type KnowledgeSource,
  type KnowledgeSourcesRepository,
  type RegionKind,
  type RegisterKnowledgeSourceInput,
} from '../types.js';
import { computeBlackboardHash, GENESIS_HASH } from '../audit/hash-chain.js';

export function createInMemoryKnowledgeSourcesRepository(): KnowledgeSourcesRepository {
  const rows = new Map<string, KnowledgeSource>();
  // Secondary index keyed by `${tenantId}::${ksKind}::${ksName}` for
  // idempotent register.
  const byTriple = new Map<string, KnowledgeSource>();

  return {
    async register(input: RegisterKnowledgeSourceInput) {
      const tripleKey = `${input.tenantId}::${input.ksKind}::${input.ksName}`;
      const existing = byTriple.get(tripleKey);
      if (existing !== undefined) return existing;
      const id = randomUUID();
      const regionFilter = input.regionFilter ?? [];
      const priority = input.priority ?? 0.5;
      const auditHash = computeBlackboardHash(
        {
          op: 'register-ks',
          tenantId: input.tenantId,
          ksKind: input.ksKind,
          ksName: input.ksName,
          regionFilter: regionFilter.slice(),
          priority,
        },
        GENESIS_HASH,
      );
      const row: KnowledgeSource = Object.freeze({
        id,
        tenantId: input.tenantId,
        ksKind: input.ksKind,
        ksName: input.ksName,
        regionFilter: Object.freeze(regionFilter.slice()),
        priority,
        auditHash,
      });
      rows.set(id, row);
      byTriple.set(tripleKey, row);
      return row;
    },

    async listForRegion(tenantId: string, regionKind: RegionKind) {
      const out: KnowledgeSource[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        // An empty region_filter means "applies to all regions" —
        // matches every regionKind.
        if (
          row.regionFilter.length > 0 &&
          !row.regionFilter.includes(regionKind)
        ) {
          continue;
        }
        out.push(row);
      }
      return out
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async getById(tenantId: string, id: string) {
      const row = rows.get(id);
      if (row === undefined) return null;
      if (row.tenantId !== tenantId) return null;
      return row;
    },
  };
}
