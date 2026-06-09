/**
 * Read-only tool-dispatch port for widget-data bindings (W3b).
 *
 * A `{ kind: 'tool', toolId, args? }` widget binding wants to INVOKE a vetted
 * action and show its result. The widget-data resolver is a RENDER-TIME read
 * path, so only READ-ONLY tools may run here — a mutating tool (create_reminder,
 * create_mining_task, request_document, notify_owner) is NEVER executed from a
 * widget read; sovereign + money rails (LedgerService.post, kill-switch,
 * four-eye) are not in the portal-genui registry at all and can never reach this
 * port. The resolver asserts membership in `READ_ONLY_TOOL` BEFORE it ever calls
 * the port, so the port only ever sees an allow-listed read tool.
 *
 * GENERATIVE by construction: there is no per-tool handler. Each read-only tool
 * is a bounded, tenant-scoped read/aggregate COMPOSED from the binding's `args`
 * over the SAME allow-listed `RESOURCE_TABLE` map the query path uses — adding a
 * read tool is a registry entry + (optionally) one dispatch branch here, never a
 * new code path elsewhere. The two read tools the platform exposes today are:
 *
 *   - `export_records` — a bounded tenant-scoped SELECT over a vetted resource
 *     (`args.resource`); returns the rows for the renderer to export/display.
 *   - `recompute_royalty_estimate` — a generic `COUNT(*)` or `SUM(<field>)`
 *     rollup over a vetted resource (`args.resource`, `args.field?`); returns a
 *     single `value` for a kpi_card.
 *
 * Every read is filtered by `tenant_id = $1`; RLS (FORCE on
 * `app.current_tenant_id`) is the DB-side backstop, bound per-request by
 * api-gateway middleware. The `resource`/`field` are allow-listed constants
 * resolved from the registry/map — NEVER interpolated from user input — so a
 * binding can never steer the SELECT off-list. Any tool error degrades to empty
 * rows + a pino warn; this port NEVER throws into the request.
 *
 * Pure module: no I/O at import time, no `process.env`, the injected logger is
 * the only sink. The Postgres read port is the SAME narrow `query(sql, params)`
 * boundary the query path already injects.
 */

import { isKnownResource, type PortalToolId } from '@borjie/portal-genui';

import type {
  WidgetData,
  WidgetQueryPort,
  WidgetResolveContext,
  WidgetResolverLogger,
} from './widget-data-resolver.js';

// ────────────────────────────────────────────────────────────────────
// Port contract
// ────────────────────────────────────────────────────────────────────

/**
 * The READ-ONLY tool-dispatch boundary the resolver injects. The resolver
 * guarantees `toolId` is BOTH a known tool AND a member of `READ_ONLY_TOOL`
 * before calling `runReadTool` — the port may assume the id is read-safe but
 * still hard-fails closed (empty rows) for any id it does not implement.
 */
export interface ReadOnlyToolPort {
  runReadTool(
    toolId: PortalToolId,
    args: Readonly<Record<string, unknown>> | undefined,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData>;
}

export interface ReadOnlyToolPortDeps {
  /** Tenant-scoped Postgres read port — the same one the query path uses. */
  readonly query?: WidgetQueryPort;
  readonly logger: WidgetResolverLogger;
}

// ────────────────────────────────────────────────────────────────────
// Allow-listed resource → physical table, mirroring the query path. A tool
// `args.resource` that is NOT in this map degrades to empty — never a 500,
// never an arbitrary table.
// ────────────────────────────────────────────────────────────────────

const READ_ROW_LIMIT = 100;

/**
 * Mapped estate domains → their physical table. Kept in lock-step with the
 * resolver's own `RESOURCE_TABLE`; only tables VERIFIED to carry
 * `tenant_id` + `created_at` are listed. A bare allow-listed table name (never
 * interpolated from user input) so the SELECT can never be steered off-list.
 */
const TOOL_RESOURCE_TABLE: Readonly<Record<string, string>> = {
  licences: 'licences',
  employees: 'employees',
  production_records: 'production_records',
  reminders: 'reminders',
  mining_tasks: 'mining_tasks',
};

/** A SQL-identifier-safe column (lower snake_case, ≤ 60 chars). */
const SAFE_COLUMN = /^[a-z][a-z0-9_]{0,59}$/;

function resolveTable(args: Readonly<Record<string, unknown>> | undefined): string | null {
  const raw = args?.['resource'];
  if (typeof raw !== 'string' || !isKnownResource(raw)) return null;
  return TOOL_RESOURCE_TABLE[raw] ?? null;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

// ────────────────────────────────────────────────────────────────────
// Default generic read-tool port — composes each read-only tool from the
// binding args over the allow-listed table map. No DB wired (dev/test/smoke)
// ⇒ honest empty rows, never a crash.
// ────────────────────────────────────────────────────────────────────

export function createDefaultReadOnlyToolPort(
  deps: ReadOnlyToolPortDeps,
): ReadOnlyToolPort {
  const { query, logger } = deps;

  /** A bounded, tenant-scoped SELECT over a vetted resource → rows. */
  async function exportRecords(
    args: Readonly<Record<string, unknown>> | undefined,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData> {
    if (!query) return { rows: [] };
    const table = resolveTable(args);
    if (!table) {
      logger.warn(
        { toolId: 'export_records', resource: args?.['resource'] ?? null },
        'widget-read-tool: export_records resource unmapped — empty rows',
      );
      return { rows: [] };
    }
    const rows = await query.query<Record<string, unknown>>(
      // `table` is an allow-listed constant from TOOL_RESOURCE_TABLE — never
      // user input — so the identifier interpolation is safe. The tenant
      // predicate is parameterised; RLS FORCE is the DB-side backstop.
      `SELECT * FROM public.${table} WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [ctx.tenantId, READ_ROW_LIMIT],
    );
    return { rows: rows.map((r) => ({ ...r })) };
  }

  /**
   * A generic rollup over a vetted resource → a single `value` for a kpi_card.
   * `args.op` selects `count` (default) or `sum`; `args.field` (allow-listed
   * column shape) is the SUM target. The aggregate is read-only by definition.
   */
  async function rollup(
    args: Readonly<Record<string, unknown>> | undefined,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData> {
    if (!query) return { value: null };
    const table = resolveTable(args);
    if (!table) {
      logger.warn(
        { toolId: 'recompute_royalty_estimate', resource: args?.['resource'] ?? null },
        'widget-read-tool: rollup resource unmapped — null value',
      );
      return { value: null };
    }
    const op = args?.['op'] === 'sum' ? 'sum' : 'count';
    const field = typeof args?.['field'] === 'string' ? (args['field'] as string) : '';
    // SUM requires a SQL-identifier-safe column; an unsafe/absent field falls
    // back to COUNT(*) so a binding can never inject an expression.
    const aggregate =
      op === 'sum' && SAFE_COLUMN.test(field)
        ? `COALESCE(SUM(${field}), 0)`
        : 'COUNT(*)';
    const result = await query.query<{ value: number | string | null }>(
      `SELECT ${aggregate} AS value FROM public.${table} WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const value = result[0]?.value ?? 0;
    return { value: typeof value === 'string' ? Number(value) : value };
  }

  return {
    async runReadTool(
      toolId: PortalToolId,
      args: Readonly<Record<string, unknown>> | undefined,
      ctx: WidgetResolveContext,
    ): Promise<WidgetData> {
      try {
        switch (toolId) {
          case 'export_records':
            return await exportRecords(args, ctx);
          case 'recompute_royalty_estimate':
            return await rollup(args, ctx);
          default:
            // A read-only tool with no generic implementation yet — honest
            // empty, never a fabricated result. Adding it is one branch above.
            logger.info(
              { toolId },
              'widget-read-tool: read-only tool has no generic rollup yet — empty rows',
            );
            return { rows: [] };
        }
      } catch (err) {
        logger.warn(
          { toolId, err: errMessage(err) },
          'widget-read-tool: read-tool dispatch failed — degrading to empty rows',
        );
        return { rows: [] };
      }
    },
  };
}
