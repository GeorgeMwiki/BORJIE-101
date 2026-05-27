/**
 * `forecast_runs` repository — Wave SOTA-FORECAST.
 *
 * Two adapters: in-memory (tests + default composition root) and a
 * SQL adapter port. The SQL adapter takes an injected driver shape
 * so the package itself stays drizzle-free; the host service wires
 * a drizzle binding at the composition root.
 *
 * Every row is frozen on insert. The audit chain (audit_hash,
 * prev_hash) uses the same primitive as migration 0066 — sha256 of
 * canonical-JSON(prev || payload), starting from `GENESIS_HASH` per
 * tenant.
 *
 * @module @borjie/forecasting/sota/repositories/forecast-runs-repository
 */

import { randomUUID } from 'node:crypto';
import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';
import type {
  ForecastRun,
  ForecastRunRepository,
  ForecastTarget,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Hash
// ─────────────────────────────────────────────────────────────────────

function computeAuditHash(
  payload: Readonly<Record<string, unknown>>,
  prevHash: string = GENESIS_HASH,
): string {
  return chainHash({ prev: prevHash, payload });
}

// ─────────────────────────────────────────────────────────────────────
// In-memory
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryForecastRunRepoDeps {
  readonly now?: () => Date;
}

export function createInMemoryForecastRunRepository(
  deps: InMemoryForecastRunRepoDeps = {},
): ForecastRunRepository {
  const now = deps.now ?? ((): Date => new Date());
  const rows = new Map<string, ForecastRun>();
  const chainHead = new Map<string, string>();
  return {
    async insert(input) {
      const id = randomUUID();
      const ranAt = now();
      const prevHash = chainHead.get(input.tenantId) ?? GENESIS_HASH;
      const auditHash = computeAuditHash(
        {
          op: 'insert',
          tenantId: input.tenantId,
          target: input.target,
          horizon: input.horizon,
          model: input.model,
          ranAt: ranAt.toISOString(),
        },
        prevHash,
      );
      const row: ForecastRun = Object.freeze({
        id,
        tenantId: input.tenantId,
        target: input.target,
        horizon: input.horizon,
        model: input.model,
        pointForecast: Object.freeze([...input.pointForecast]),
        intervals80: Object.freeze(input.intervals80.map((b) => Object.freeze({ ...b }))),
        intervals95: Object.freeze(input.intervals95.map((b) => Object.freeze({ ...b }))),
        metrics: Object.freeze({ ...input.metrics }),
        ranAt,
        prevHash,
        auditHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      return row;
    },

    async findById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined) return null;
      if (row.tenantId !== tenantId) return null;
      return row;
    },

    async listForTenant(tenantId, filter) {
      const out: ForecastRun[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (filter?.target !== undefined && row.target !== filter.target) continue;
        if (filter?.model !== undefined && row.model !== filter.model) continue;
        out.push(row);
      }
      out.sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
      return out;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// SQL adapter — driver port
// ─────────────────────────────────────────────────────────────────────

export interface SqlForecastRunDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export interface SqlForecastRunRepoDeps {
  readonly driver: SqlForecastRunDriver;
  readonly now?: () => Date;
}

function rowToForecastRun(r: Record<string, unknown>): ForecastRun {
  const ranAtRaw = r['ran_at'];
  const ranAt =
    ranAtRaw instanceof Date ? ranAtRaw : new Date(String(ranAtRaw));
  return Object.freeze({
    id: String(r['id']),
    tenantId: String(r['tenant_id']),
    target: r['target'] as ForecastTarget,
    horizon: Number(r['horizon']),
    model: String(r['model']),
    pointForecast: Object.freeze(
      (r['point_forecast'] as ReadonlyArray<number>) ?? [],
    ),
    intervals80: Object.freeze(
      ((r['intervals_80'] as ReadonlyArray<Record<string, number>>) ?? []).map(
        (b) =>
          Object.freeze({
            step: Number(b['step']),
            lower: Number(b['lower']),
            upper: Number(b['upper']),
          }),
      ),
    ),
    intervals95: Object.freeze(
      ((r['intervals_95'] as ReadonlyArray<Record<string, number>>) ?? []).map(
        (b) =>
          Object.freeze({
            step: Number(b['step']),
            lower: Number(b['lower']),
            upper: Number(b['upper']),
          }),
      ),
    ),
    metrics: Object.freeze(
      (r['metrics'] as Readonly<Record<string, number>>) ?? {},
    ),
    ranAt,
    prevHash: String(r['prev_hash'] ?? ''),
    auditHash: String(r['audit_hash']),
  });
}

export function createSqlForecastRunRepository(
  deps: SqlForecastRunRepoDeps,
): ForecastRunRepository {
  const now = deps.now ?? ((): Date => new Date());
  return {
    async insert(input) {
      const headRows = await deps.driver.query({
        text: `
          SELECT audit_hash
            FROM forecast_runs
           WHERE tenant_id = $1
           ORDER BY ran_at DESC
           LIMIT 1
        `,
        values: [input.tenantId],
      });
      const prevHash =
        (headRows[0]?.['audit_hash'] as string | undefined) ?? GENESIS_HASH;
      const id = randomUUID();
      const ranAt = now();
      const auditHash = computeAuditHash(
        {
          op: 'insert',
          tenantId: input.tenantId,
          target: input.target,
          horizon: input.horizon,
          model: input.model,
          ranAt: ranAt.toISOString(),
        },
        prevHash,
      );
      const rows = await deps.driver.query({
        text: `
          INSERT INTO forecast_runs
            (id, tenant_id, target, horizon, model,
             point_forecast, intervals_80, intervals_95, metrics,
             ran_at, prev_hash, audit_hash)
          VALUES ($1, $2, $3, $4, $5,
                  $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
                  $10, $11, $12)
          RETURNING id, tenant_id, target, horizon, model,
                    point_forecast, intervals_80, intervals_95, metrics,
                    ran_at, prev_hash, audit_hash
        `,
        values: [
          id,
          input.tenantId,
          input.target,
          input.horizon,
          input.model,
          JSON.stringify(input.pointForecast),
          JSON.stringify(input.intervals80),
          JSON.stringify(input.intervals95),
          JSON.stringify(input.metrics),
          ranAt,
          prevHash,
          auditHash,
        ],
      });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('forecast_runs.insert: no row returned');
      }
      return rowToForecastRun(row);
    },

    async findById(tenantId, id) {
      const rows = await deps.driver.query({
        text: `
          SELECT id, tenant_id, target, horizon, model,
                 point_forecast, intervals_80, intervals_95, metrics,
                 ran_at, prev_hash, audit_hash
            FROM forecast_runs
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
        `,
        values: [tenantId, id],
      });
      const row = rows[0];
      return row === undefined ? null : rowToForecastRun(row);
    },

    async listForTenant(tenantId, filter) {
      const where: string[] = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      if (filter?.target !== undefined) {
        values.push(filter.target);
        where.push(`target = $${values.length}`);
      }
      if (filter?.model !== undefined) {
        values.push(filter.model);
        where.push(`model = $${values.length}`);
      }
      const rows = await deps.driver.query({
        text: `
          SELECT id, tenant_id, target, horizon, model,
                 point_forecast, intervals_80, intervals_95, metrics,
                 ran_at, prev_hash, audit_hash
            FROM forecast_runs
           WHERE ${where.join(' AND ')}
           ORDER BY ran_at DESC
        `,
        values,
      });
      return Object.freeze(rows.map(rowToForecastRun));
    },
  };
}
