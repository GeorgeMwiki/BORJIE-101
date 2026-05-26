/**
 * Drizzle-backed loader + port for Piece B junior-chain routing
 * (issue #39).
 *
 * Queries `routing_rules` for `(tenant_id, source_kind)` ordered by
 * priority. Pure SQL via the gateway's existing Drizzle client — no
 * @borjie/dispatch-router-side database dep (per its port discipline).
 *
 * Consumed by the junior chain after a junior completes; resolves the
 * next dispatch step(s) via `JuniorRoutingRulesPort.lookup(sourceJunior,
 * payload)`.
 */

import {
  createRoutingRulesPort,
  type JuniorRoutingRulesLoader,
  type JuniorRoutingRulesPort,
  type RoutingPredicate,
  type RoutingRulesRow,
} from '@borjie/dispatch-router';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────
// Db port (matches the api-gateway's `db.execute(query)` shape)
// ─────────────────────────────────────────────────────────────────────

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────

export function createDrizzleRoutingRulesLoader(db: DbLike): JuniorRoutingRulesLoader {
  return {
    async load({ tenantId, sourceKind }) {
      try {
        const res = await db.execute(sql`
          SELECT id, tenant_id, source_kind, target_role, target_kind,
                 condition_jsonb, priority, active
            FROM routing_rules
           WHERE tenant_id = ${tenantId}
             AND source_kind = ${sourceKind}
             AND active = true
           ORDER BY priority DESC, created_at ASC
           LIMIT 50
        `);
        const rows = fetchRows(res);
        return rows.map(coerceRow);
      } catch {
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Port factory
// ─────────────────────────────────────────────────────────────────────

export interface CreateJuniorRoutingRulesPortArgs {
  readonly db: DbLike;
  readonly tenantId: string;
}

export function createJuniorRoutingRulesPort(
  args: CreateJuniorRoutingRulesPortArgs,
): JuniorRoutingRulesPort {
  return createRoutingRulesPort({
    tenantId: args.tenantId,
    loader: createDrizzleRoutingRulesLoader(args.db),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function coerceRow(r: Record<string, unknown>): RoutingRulesRow {
  const targetRole = String(r.target_role ?? 'junior');
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    sourceKind: String(r.source_kind),
    targetRole: targetRole === 'human' ? 'human' : 'junior',
    targetKind: String(r.target_kind),
    conditionJsonb: coerceCondition(r.condition_jsonb),
    priority: Number(r.priority ?? 100),
    active: Boolean(r.active),
  };
}

function coerceCondition(raw: unknown): RoutingPredicate {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as RoutingPredicate;
  }
  return {};
}

function fetchRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  if (res && typeof res === 'object' && 'rows' in res) {
    return ((res as { rows?: unknown[] }).rows ??
      []) as Array<Record<string, unknown>>;
  }
  return [];
}
