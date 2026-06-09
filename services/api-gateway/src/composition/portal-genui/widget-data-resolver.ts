/**
 * Widget-data resolver — turns a generated widget's `binding` into LIVE,
 * tenant-scoped rows at render time.
 *
 * A generated `PortalTabWidget` MAY carry a `binding` (the K1a schema shape,
 * the persisted canonical):
 *
 *   - `{ kind: 'query', resource, filters? }` — the widget reads LIVE rows from
 *     a vetted estate domain (licences, employees, production_records, …) or
 *     the tab's OWN records (`tab_records`). `resource` is validated against the
 *     capability registry (`isKnownResource`) exactly like a widget kind.
 *   - `{ kind: 'tool', toolId, args? }` — the widget would invoke a vetted
 *     action. `toolId` is validated against `isKnownTool`. Read-only tool
 *     dispatch is a LATER seam — this resolver NEVER executes a mutating tool;
 *     it returns an empty `{ rows: [] }` for tool bindings for now.
 *
 * GENERATIVE by construction: there is no per-widget handler. A mapped resource
 * resolves through ONE bounded, tenant-scoped `SELECT … LIMIT 100` over the
 * shared `WidgetQueryPort` (the same narrow `query(sql, params)` boundary
 * `portal-genui-wiring.ts` already builds from Drizzle's `$client`). A
 * known-but-unmapped resource degrades to an honest empty `{ rows: [] }` — it
 * never 500s. `tab_records` resolves through the injected `RecordStore` so the
 * tab's own collected submissions flow back into its widgets.
 *
 * Tenant isolation: every SQL read is filtered by `tenant_id = $1` AND RLS
 * (FORCE on `app.current_tenant_id`) is enforced in the DB — the GUC is bound
 * per-request by api-gateway middleware. No app-side double-filtering beyond the
 * explicit predicate (defense-in-depth, mirrors the record store).
 *
 * Pure module: no I/O at import time, no `process.env`, pino is the only logger
 * (passed in). Honest-degrade everywhere — a resolver failure logs + returns
 * empty rows rather than throwing into the request.
 */

import {
  isKnownResource,
  isKnownTool,
  type PortalQueryResource,
  type RecordStore,
} from '@borjie/portal-genui';

// ────────────────────────────────────────────────────────────────────
// Ports + public shapes
// ────────────────────────────────────────────────────────────────────

/**
 * Narrow Postgres read port — the SAME `query(sql, params)` boundary the
 * portal-genui wiring already constructs from Drizzle's `$client.unsafe`. We
 * re-declare it here (rather than import `DbExecutor`) so the resolver depends
 * on nothing heavier than this signature.
 */
export interface WidgetQueryPort {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<Row>>;
}

/**
 * The binding the resolver consumes — the canonical K1a shape
 * (`resource`/`filters` for query, `toolId`/`args` for tool). Kept permissive
 * (the router parses + narrows before calling); the resolver re-validates the
 * NAME against the registry so an unknown resource/tool is rejected here too.
 */
export type ResolvableBinding =
  | {
      readonly kind: 'query';
      readonly resource: string;
      // `| undefined` so a zod-`.optional()` parse result (present-but-undefined
      // under exactOptionalPropertyTypes) is accepted verbatim at the call site.
      readonly filters?: Readonly<Record<string, unknown>> | undefined;
    }
  | {
      readonly kind: 'tool';
      readonly toolId: string;
      readonly args?: Readonly<Record<string, unknown>> | undefined;
    };

/**
 * The resolved widget data the renderer reads. Loose by construction — the
 * render site picks the field that matches the widget kind (`rows` for table,
 * `value` for kpi_card, `items` for timeline). `columns` is an optional hint.
 */
export interface WidgetData {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  readonly value?: number | string | null;
  readonly items?: ReadonlyArray<Record<string, unknown>>;
  readonly columns?: ReadonlyArray<string>;
}

/** The tab context the resolver needs to scope a read (id for `tab_records`). */
export interface WidgetResolveContext {
  readonly tenantId: string;
  /** The owning tab id — used to scope `tab_records` to this tab. */
  readonly tabId: string;
}

/**
 * Narrow structural logger the resolver emits to. Satisfied by both the
 * api-gateway `logger` util and pino — we accept the `(meta, message)` order
 * those use. Declared here so the module depends on no logging package.
 */
export interface WidgetResolverLogger {
  warn(meta: Record<string, unknown>, message: string): void;
  info(meta: Record<string, unknown>, message: string): void;
}

export interface WidgetDataResolverDeps {
  /** Tenant-scoped read port for mapped estate domains. Optional in dev/test. */
  readonly query?: WidgetQueryPort;
  /** Record store — resolves the `tab_records` resource to the tab's own rows. */
  readonly recordStore: RecordStore;
  readonly logger: WidgetResolverLogger;
}

export interface WidgetDataResolver {
  resolve(
    binding: ResolvableBinding,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData>;
}

// ────────────────────────────────────────────────────────────────────
// Resource → table mapping. GENERATIVE: a vetted domain that has a real
// tenant-scoped table is mapped to a bounded SELECT by COMPOSITION (one entry).
// A known resource ABSENT from this map degrades to empty rows — never a 500 —
// so adding the read later is a one-line map entry, not new code elsewhere.
// `tab_records` is resolved separately through the record store.
// ────────────────────────────────────────────────────────────────────

const READ_ROW_LIMIT = 100;

/**
 * Mapped estate domains → their physical table. Only tables we have VERIFIED
 * carry `tenant_id` + `created_at` are listed; every other known resource
 * degrades to empty rows. Each value is a bare, allow-listed table name (never
 * interpolated from user input) so the SELECT can never be steered off-list.
 */
const RESOURCE_TABLE: Partial<Record<PortalQueryResource, string>> = {
  licences: 'licences',
  employees: 'employees',
  production_records: 'production_records',
  reminders: 'reminders',
  mining_tasks: 'mining_tasks',
};

// ────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────

export function createWidgetDataResolver(
  deps: WidgetDataResolverDeps,
): WidgetDataResolver {
  const { query, recordStore, logger } = deps;

  /** The tab's own collected records → widget rows. */
  async function resolveTabRecords(
    ctx: WidgetResolveContext,
  ): Promise<WidgetData> {
    try {
      const records = await recordStore.listRecords({
        tenantId: ctx.tenantId,
        tabId: ctx.tabId,
        limit: READ_ROW_LIMIT,
      });
      // The render site reads `payload` (the tab-shaped submission) but we also
      // surface the row envelope so a table widget can show created-at / id.
      const rows = records.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        ...r.payload,
      }));
      return { rows };
    } catch (err) {
      logger.warn(
        { resource: 'tab_records', err: errMessage(err) },
        'widget-data: tab_records read failed — degrading to empty rows',
      );
      return { rows: [] };
    }
  }

  /** A mapped estate domain → a bounded, tenant-scoped SELECT. */
  async function resolveMappedTable(
    table: string,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData> {
    if (!query) {
      // No DB wired (dev/test/smoke) — honest empty, never crash.
      return { rows: [] };
    }
    try {
      const rows = await query.query<Record<string, unknown>>(
        // `table` is an allow-listed constant from RESOURCE_TABLE — never user
        // input — so the identifier interpolation is safe. The tenant predicate
        // is parameterised; RLS FORCE is the DB-side backstop.
        `SELECT * FROM public.${table} WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [ctx.tenantId, READ_ROW_LIMIT],
      );
      return { rows: rows.map((r) => ({ ...r })) };
    } catch (err) {
      logger.warn(
        { resource: table, err: errMessage(err) },
        'widget-data: mapped-table read failed — degrading to empty rows',
      );
      return { rows: [] };
    }
  }

  async function resolveQuery(
    resource: string,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData> {
    // Re-validate the NAME against the registry — defense in depth even though
    // the router already parsed the binding (an unknown resource is rejected,
    // never silently empty, so a caller bypassing the schema still cannot
    // probe an arbitrary token).
    if (!isKnownResource(resource)) {
      logger.warn(
        { resource },
        'widget-data: unknown query resource — rejecting',
      );
      throw new UnknownBindingError(`unknown query resource '${resource}'`);
    }
    if (resource === 'tab_records') {
      return resolveTabRecords(ctx);
    }
    const table = RESOURCE_TABLE[resource];
    if (!table) {
      // Known-but-unmapped — honest empty rows, never a 500.
      return { rows: [] };
    }
    return resolveMappedTable(table, ctx);
  }

  async function resolveTool(toolId: string): Promise<WidgetData> {
    if (!isKnownTool(toolId)) {
      logger.warn({ toolId }, 'widget-data: unknown tool id — rejecting');
      throw new UnknownBindingError(`unknown tool '${toolId}'`);
    }
    // Read-only tool dispatch is a later seam. We NEVER execute a mutating tool
    // from a widget-data read; the binding is vetted + degrades to empty rows.
    return { rows: [] };
  }

  return {
    async resolve(
      binding: ResolvableBinding,
      ctx: WidgetResolveContext,
    ): Promise<WidgetData> {
      if (binding.kind === 'query') {
        return resolveQuery(binding.resource, ctx);
      }
      return resolveTool(binding.toolId);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Errors + helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Thrown when a binding names a resource/tool that is not in the capability
 * registry. The router maps it to a 400 (the caller forged an off-list name);
 * a clean degrade (known-but-unmapped) returns empty rows instead of throwing.
 */
export class UnknownBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownBindingError';
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}
