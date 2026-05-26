/**
 * Dialect-signals repository — in-memory + SQL.
 *
 * Per-user counters: how many utterances have we scored as Bongo /
 * Coastal / Kenyan / Sheng / Standard? Drives the per-user register
 * adaptation in downstream voice / chat code.
 *
 * > Locked default per FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 *   Decision 3: dialect-signal data is *tier-3 aggregate only* in
 *   supervisor / owner views; the per-user trail is redactor-gated
 *   upstream.
 */

import type {
  Dialect,
  SwahiliDialectSignalRow,
  SwahiliDialectSignalsRepository,
} from '../types.js';
import { computeSwahiliAuditHash, GENESIS_HASH } from '../audit/audit-chain-link.js';
import type { SqlRunner } from './sql-runner.js';

function key(tenantId: string, userId: string, dialect: Dialect): string {
  return `${tenantId}::${userId}::${dialect}`;
}

export interface InMemoryDialectSignalsDeps {
  readonly uuid: () => string;
}

export function createInMemoryDialectSignalsRepository(
  deps: InMemoryDialectSignalsDeps = {
    uuid: () => crypto.randomUUID(),
  },
): SwahiliDialectSignalsRepository {
  const rows = new Map<string, SwahiliDialectSignalRow>();

  return Object.freeze({
    async increment(
      tenantId: string,
      userId: string,
      dialect: Dialect,
      observedAt: string,
    ): Promise<SwahiliDialectSignalRow> {
      const k = key(tenantId, userId, dialect);
      const existing = rows.get(k);
      const newCount = (existing?.signalCount ?? 0) + 1;
      const id = existing?.id ?? deps.uuid();
      const auditHash = computeSwahiliAuditHash(
        {
          kind: 'dialect-signal.increment',
          tenantId,
          userId,
          dialect,
          observedAt,
          signalCount: newCount,
        },
        existing?.auditHash ?? GENESIS_HASH,
      );
      const next: SwahiliDialectSignalRow = Object.freeze({
        id,
        tenantId,
        userId,
        dialect,
        signalCount: newCount,
        lastObserved: observedAt,
        auditHash,
      });
      rows.set(k, next);
      return next;
    },
    async read(
      tenantId: string,
      userId: string,
    ): Promise<ReadonlyArray<SwahiliDialectSignalRow>> {
      const out: SwahiliDialectSignalRow[] = [];
      for (const r of rows.values()) {
        if (r.tenantId === tenantId && r.userId === userId) {
          out.push(r);
        }
      }
      return Object.freeze(out);
    },
  });
}

interface RawSignalRow extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly dialect: string;
  readonly signal_count: number;
  readonly last_observed: string;
  readonly audit_hash: string;
}

function isDialect(d: string): d is Dialect {
  return (
    d === 'bongo' ||
    d === 'coastal' ||
    d === 'kenyan' ||
    d === 'sheng' ||
    d === 'standard'
  );
}

function mapRow(row: RawSignalRow): SwahiliDialectSignalRow {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    dialect: isDialect(row.dialect) ? row.dialect : 'standard',
    signalCount: Number(row.signal_count),
    lastObserved: row.last_observed,
    auditHash: row.audit_hash,
  });
}

export function createSqlDialectSignalsRepository(
  runner: SqlRunner,
): SwahiliDialectSignalsRepository {
  return Object.freeze({
    async increment(
      tenantId: string,
      userId: string,
      dialect: Dialect,
      observedAt: string,
    ): Promise<SwahiliDialectSignalRow> {
      const auditHash = computeSwahiliAuditHash({
        kind: 'dialect-signal.increment',
        tenantId,
        userId,
        dialect,
        observedAt,
      });
      const sql = `
        INSERT INTO swahili_dialect_signals (
          tenant_id, user_id, dialect, signal_count, last_observed, audit_hash
        ) VALUES (
          $1, $2, $3, 1, $4, $5
        )
        ON CONFLICT (tenant_id, user_id, dialect) DO UPDATE
          SET signal_count  = swahili_dialect_signals.signal_count + 1,
              last_observed = EXCLUDED.last_observed,
              audit_hash    = EXCLUDED.audit_hash
        RETURNING id, tenant_id, user_id, dialect, signal_count, last_observed, audit_hash
      `;
      const rs = await runner.execute<RawSignalRow>(sql, [
        tenantId,
        userId,
        dialect,
        observedAt,
        auditHash,
      ]);
      const head = rs[0];
      if (head === undefined) {
        throw new Error('swahili_dialect_signals upsert returned no row');
      }
      return mapRow(head);
    },
    async read(
      tenantId: string,
      userId: string,
    ): Promise<ReadonlyArray<SwahiliDialectSignalRow>> {
      const sql = `
        SELECT id, tenant_id, user_id, dialect, signal_count, last_observed, audit_hash
        FROM swahili_dialect_signals
        WHERE tenant_id = $1 AND user_id = $2
        ORDER BY signal_count DESC, last_observed DESC
      `;
      const rs = await runner.execute<RawSignalRow>(sql, [tenantId, userId]);
      return Object.freeze(rs.map(mapRow));
    },
  });
}
