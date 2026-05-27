/**
 * `graph_db_queries` repository — Migration 0068.
 *
 * Two adapters: in-memory (tests + default composition root) and a
 * SQL adapter port. SQL is wired by the host service against
 * drizzle/pg at the composition root; the package stays drizzle-free.
 *
 * Records are immutable: each row hashes its payload against the
 * prior row in the tenant's chain via `@borjie/audit-hash-chain`.
 *
 * @module @borjie/graph-database/repositories/graph-run-repository
 */

import { randomUUID } from 'node:crypto';
import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';
import {
  GraphDatabaseError,
  type GraphDriverId,
} from '../types.js';

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

export interface GraphRunRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly driver: GraphDriverId;
  readonly queryCypher: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly latencyMs: number;
  readonly ranAt: Date;
  readonly prevHash: string;
  readonly auditHash: string;
}

export interface InsertGraphRunInput {
  readonly tenantId: string;
  readonly driver: GraphDriverId;
  readonly queryCypher: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly latencyMs: number;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface GraphRunRepository {
  readonly insert: (input: InsertGraphRunInput) => Promise<GraphRunRecord>;
  readonly findByTenant: (
    tenantId: string,
    options?: { readonly limit?: number },
  ) => Promise<ReadonlyArray<GraphRunRecord>>;
  readonly findByAuditHash: (auditHash: string) => Promise<GraphRunRecord | null>;
  readonly headHash: (tenantId: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export interface InMemoryGraphRunRepoDeps {
  readonly now: () => Date;
}

export function createInMemoryGraphRunRepository(
  deps: InMemoryGraphRunRepoDeps = { now: () => new Date() },
): GraphRunRepository {
  const rows = new Map<string, GraphRunRecord>();
  const chainHead = new Map<string, string>();
  const byAuditHash = new Map<string, string>();

  function head(tenantId: string): string {
    return chainHead.get(tenantId) ?? GENESIS_HASH;
  }

  return {
    async insert(input) {
      assertInput(input);
      const id = randomUUID();
      const ranAt = deps.now();
      const prevHash = head(input.tenantId);
      const auditHash = chainHash({
        prev: prevHash,
        payload: {
          op: 'insert',
          tenantId: input.tenantId,
          driver: input.driver,
          queryCypher: input.queryCypher,
          params: input.params,
          latencyMs: input.latencyMs,
          ranAt: ranAt.toISOString(),
        },
      });
      const row: GraphRunRecord = Object.freeze({
        id,
        tenantId: input.tenantId,
        driver: input.driver,
        queryCypher: input.queryCypher,
        params: input.params,
        latencyMs: input.latencyMs,
        ranAt,
        prevHash,
        auditHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      byAuditHash.set(auditHash, id);
      return row;
    },
    async findByTenant(tenantId, options) {
      const all = [...rows.values()]
        .filter((r) => r.tenantId === tenantId)
        .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
      if (options?.limit !== undefined) {
        return all.slice(0, options.limit);
      }
      return all;
    },
    async findByAuditHash(auditHash) {
      const id = byAuditHash.get(auditHash);
      if (!id) return null;
      return rows.get(id) ?? null;
    },
    async headHash(tenantId) {
      return head(tenantId);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — host wires this in
// ---------------------------------------------------------------------------

export interface SqlGraphRunDriver {
  readonly insertRow: (row: GraphRunRecord) => Promise<void>;
  readonly selectByTenant: (
    tenantId: string,
    limit: number,
  ) => Promise<ReadonlyArray<GraphRunRecord>>;
  readonly selectByAuditHash: (auditHash: string) => Promise<GraphRunRecord | null>;
  readonly selectHeadHash: (tenantId: string) => Promise<string | null>;
}

export interface SqlGraphRunRepoDeps {
  readonly driver: SqlGraphRunDriver;
  readonly now: () => Date;
}

export function createSqlGraphRunRepository(
  deps: SqlGraphRunRepoDeps,
): GraphRunRepository {
  return {
    async insert(input) {
      assertInput(input);
      const id = randomUUID();
      const ranAt = deps.now();
      const prevHash =
        (await deps.driver.selectHeadHash(input.tenantId)) ?? GENESIS_HASH;
      const auditHash = chainHash({
        prev: prevHash,
        payload: {
          op: 'insert',
          tenantId: input.tenantId,
          driver: input.driver,
          queryCypher: input.queryCypher,
          params: input.params,
          latencyMs: input.latencyMs,
          ranAt: ranAt.toISOString(),
        },
      });
      const row: GraphRunRecord = Object.freeze({
        id,
        tenantId: input.tenantId,
        driver: input.driver,
        queryCypher: input.queryCypher,
        params: input.params,
        latencyMs: input.latencyMs,
        ranAt,
        prevHash,
        auditHash,
      });
      await deps.driver.insertRow(row);
      return row;
    },
    async findByTenant(tenantId, options) {
      const limit = options?.limit ?? 1000;
      return deps.driver.selectByTenant(tenantId, limit);
    },
    async findByAuditHash(auditHash) {
      return deps.driver.selectByAuditHash(auditHash);
    },
    async headHash(tenantId) {
      const value = await deps.driver.selectHeadHash(tenantId);
      return value ?? GENESIS_HASH;
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function assertInput(input: InsertGraphRunInput): void {
  if (!input.tenantId || input.tenantId.trim().length === 0) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'GraphRunRepository.insert: tenantId required',
    );
  }
  if (!input.queryCypher || input.queryCypher.trim().length === 0) {
    throw new GraphDatabaseError(
      'invalid_cypher',
      'GraphRunRepository.insert: queryCypher required',
    );
  }
  if (input.latencyMs < 0 || !Number.isFinite(input.latencyMs)) {
    throw new GraphDatabaseError(
      'parameter_validation_failed',
      `GraphRunRepository.insert: latencyMs must be ≥ 0 finite (got ${String(input.latencyMs)})`,
    );
  }
}
