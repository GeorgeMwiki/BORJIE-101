/**
 * Knowledge-sources repository — in-memory + SQL adapters.
 *
 * Wave BLACKBOARD-CORE. Both adapters implement
 * `KnowledgeSourcesRepository` from `../types.ts`. Idempotent on
 * `(tenantId, ksKind, ksName)`.
 *
 * @module @borjie/blackboard-sota/repositories/knowledge-sources-repository
 */

import { GENESIS_HASH } from '@borjie/audit-hash-chain';
import { computeBlackboardHash } from '../audit/hash-chain.js';
import {
  BLACKBOARD_CONSTANTS,
  type KnowledgeSource,
  type KnowledgeSourceKind,
  type KnowledgeSourcesRepository,
  type RegionKind,
  type RegisterKnowledgeSourceInput,
} from '../types.js';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface InMemoryKnowledgeSourcesRepositoryDeps {
  readonly idFactory?: () => string;
}

export function createInMemoryKnowledgeSourcesRepository(
  deps: InMemoryKnowledgeSourcesRepositoryDeps = {},
): KnowledgeSourcesRepository {
  const idFactory = deps.idFactory ?? (() => nextId('ks'));
  const byId = new Map<string, KnowledgeSource>();
  const byTriple = new Map<string, string>(); // `${tenant}::${kind}::${name}` -> id
  const lastHashByTenant = new Map<string, string>();

  function tripleKey(tenantId: string, kind: KnowledgeSourceKind, name: string): string {
    return `${tenantId}::${kind}::${name}`;
  }

  return {
    async register(input: RegisterKnowledgeSourceInput) {
      const trip = tripleKey(input.tenantId, input.ksKind, input.ksName);
      const existingId = byTriple.get(trip);
      if (existingId !== undefined) {
        // Idempotent — return the existing row.
        const row = byId.get(existingId);
        if (row !== undefined) return row;
      }
      const id = idFactory();
      const priority =
        input.priority ?? BLACKBOARD_CONSTANTS.DEFAULT_KS_PRIORITY[input.ksKind];
      const regionFilter = input.regionFilter ?? [];
      const prev = lastHashByTenant.get(input.tenantId) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'ks:register',
          id,
          tenantId: input.tenantId,
          ksKind: input.ksKind,
          ksName: input.ksName,
          regionFilter: [...regionFilter],
          priority,
        },
        prev,
      );
      const row: KnowledgeSource = Object.freeze({
        id,
        tenantId: input.tenantId,
        ksKind: input.ksKind,
        ksName: input.ksName,
        regionFilter: Object.freeze([...regionFilter]),
        priority,
        auditHash,
      });
      byId.set(id, row);
      byTriple.set(trip, id);
      lastHashByTenant.set(input.tenantId, auditHash);
      return row;
    },

    async listForRegion(tenantId, regionKind: RegionKind) {
      const out: KnowledgeSource[] = [];
      for (const r of byId.values()) {
        if (r.tenantId !== tenantId) continue;
        if (r.regionFilter.length > 0 && !r.regionFilter.includes(regionKind)) {
          continue;
        }
        out.push(r);
      }
      out.sort((a, b) => a.id.localeCompare(b.id));
      return Object.freeze([...out]);
    },

    async getById(tenantId, id) {
      const r = byId.get(id);
      if (r === undefined || r.tenantId !== tenantId) return null;
      return r;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

export interface KnowledgeSourcesSqlDriver {
  insertRow(row: {
    readonly id: string;
    readonly tenantId: string;
    readonly ksKind: KnowledgeSourceKind;
    readonly ksName: string;
    readonly regionFilter: ReadonlyArray<RegionKind>;
    readonly priority: number;
    readonly auditHash: string;
  }): Promise<void>;
  selectByTriple(
    tenantId: string,
    ksKind: KnowledgeSourceKind,
    ksName: string,
  ): Promise<KnowledgeSource | null>;
  selectById(tenantId: string, id: string): Promise<KnowledgeSource | null>;
  selectByTenantFilter(
    tenantId: string,
    regionKind: RegionKind,
  ): Promise<ReadonlyArray<KnowledgeSource>>;
  selectLastAuditHash(tenantId: string): Promise<string | null>;
}

export function createSqlKnowledgeSourcesRepository(
  driver: KnowledgeSourcesSqlDriver,
  deps: { readonly idFactory?: () => string } = {},
): KnowledgeSourcesRepository {
  const idFactory = deps.idFactory ?? (() => nextId('ks'));
  return {
    async register(input) {
      const existing = await driver.selectByTriple(
        input.tenantId,
        input.ksKind,
        input.ksName,
      );
      if (existing !== null) return existing;
      const id = idFactory();
      const priority =
        input.priority ?? BLACKBOARD_CONSTANTS.DEFAULT_KS_PRIORITY[input.ksKind];
      const regionFilter = input.regionFilter ?? [];
      const prev =
        (await driver.selectLastAuditHash(input.tenantId)) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'ks:register',
          id,
          tenantId: input.tenantId,
          ksKind: input.ksKind,
          ksName: input.ksName,
          regionFilter: [...regionFilter],
          priority,
        },
        prev,
      );
      const row: KnowledgeSource = Object.freeze({
        id,
        tenantId: input.tenantId,
        ksKind: input.ksKind,
        ksName: input.ksName,
        regionFilter: Object.freeze([...regionFilter]),
        priority,
        auditHash,
      });
      await driver.insertRow(row);
      return row;
    },
    async listForRegion(tenantId, regionKind) {
      return driver.selectByTenantFilter(tenantId, regionKind);
    },
    async getById(tenantId, id) {
      return driver.selectById(tenantId, id);
    },
  };
}
