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
 *   - `{ kind: 'tool', toolId, args? }` — the widget invokes a vetted action.
 *     `toolId` is validated against `isKnownTool` AND asserted READ-ONLY
 *     (membership in `READ_ONLY_TOOL`). A READ-ONLY tool dispatches against the
 *     injected `ReadOnlyToolPort` (a bounded, tenant-scoped read/aggregate); a
 *     MUTATING tool is NEVER executed from this render path — it degrades to an
 *     empty `{ rows: [] }` + a warn. Sovereign + money rails are not in the
 *     portal-genui tool registry at all and can never reach this resolver.
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
  attemptHeal,
  type PortalQueryResource,
  type PortalToolId,
  type RecordStore,
  type RepairOutcome,
  type BlockerSignal,
} from '@borjie/portal-genui';

import {
  createDefaultReadOnlyToolPort,
  type ReadOnlyToolPort,
} from './widget-read-tool-port.js';

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
  /**
   * READ-ONLY tool-dispatch port for `{ kind: 'tool' }` bindings. Optional: when
   * omitted, a default generic port is composed from `query` (bounded rollups
   * over the allow-listed resource map). A MUTATING tool never reaches it —
   * `resolveTool` asserts `READ_ONLY_TOOL` membership first.
   */
  readonly toolPort?: ReadOnlyToolPort;
  readonly logger: WidgetResolverLogger;
  /**
   * Self-healing escalation sink. A resource that is KNOWN to the registry but
   * has no table mapping AND is not in the deliberately-unmapped set is a real
   * wiring gap. The read still degrades to honest empty rows, but we recognise
   * it as an `unmapped-binding` blocker and escalate a human-gated
   * `RepairProposal` to the internal-admin self-healing console. When omitted,
   * the read still proceeds.
   */
  readonly onBlocker?: (outcome: RepairOutcome, signal: BlockerSignal) => void;
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
 *
 * Exported (read-only) so a CI coverage test can assert that every
 * `PortalQueryResource` either has a mapping here OR is in the documented
 * `INTENTIONALLY_UNMAPPED_RESOURCES` set — so a newly-added resource can never
 * silently degrade to empty rows without an explicit decision.
 */
export const RESOURCE_TABLE: Partial<Record<PortalQueryResource, string>> = {
  licences: 'licences',
  employees: 'employees',
  // production_records orders by `ts` (its only timestamp column), NOT
  // created_at — see RESOURCE_ORDER_BY below. Ordering by created_at would
  // reference a non-existent column and degrade every read to empty rows.
  production_records: 'production_records',
  reminders: 'reminders',
  mining_tasks: 'mining_tasks',
  // Mining marketplace + offtake — all VERIFIED to carry tenant_id +
  // created_at (marketplace.schema.ts / marketplace-bids.schema.ts /
  // offtake-agreements.schema.ts).
  marketplace_listings: 'marketplace_listings',
  marketplace_bids: 'marketplace_bids',
  offtake_agreements: 'offtake_agreements',
  // Safety incidents — safety-csr.schema.ts (tenant_id + created_at).
  incidents: 'incidents',
  // Asset register — assets-fleet.schema.ts (tenant_id + created_at).
  assets: 'assets',
  // Documents → the physical document_uploads table (documents.schema.ts;
  // tenant_id + created_at). The `documents` resource name is the logical
  // capability; the physical table is document_uploads.
  documents: 'document_uploads',
  // Ledger entries — payments-ledger.schema.ts (tenant_id + created_at).
  // Read-only render path; RLS + the tenant predicate keep it isolated, and
  // the money WRITE path is unaffected (this never inserts/posts).
  ledger_entries: 'ledger_entries',
  // INTENTIONALLY UNMAPPED — see INTENTIONALLY_UNMAPPED_RESOURCES below.
};

/**
 * Default ORDER-BY column for the bounded read. Almost every mapped table
 * carries `created_at`, so that is the fallback; a table whose recency column
 * has a different name is listed in {@link RESOURCE_ORDER_BY}. Like the table
 * names above, every value here is a bare, allow-listed column constant — never
 * interpolated from user input — so the SELECT can never be steered off-column.
 */
const DEFAULT_ORDER_BY_COLUMN = 'created_at';

/**
 * Per-resource ORDER-BY override for tables whose recency column is NOT
 * `created_at`. `production_records` has only a `ts` timestamp (its sole
 * timestamp column — see `production-sales.schema.ts`); ordering it by
 * `created_at` would reference a non-existent column and degrade EVERY read to
 * empty rows. A resource absent here uses {@link DEFAULT_ORDER_BY_COLUMN}.
 *
 * Exported (read-only) so the colocated coverage test can assert the override
 * is in lock-step with the schema.
 */
export const RESOURCE_ORDER_BY: Partial<Record<PortalQueryResource, string>> = {
  production_records: 'ts',
};

/**
 * Resources that are DELIBERATELY unmapped (no surviving physical table that
 * carries both `tenant_id` and `created_at` today). They degrade to honest
 * empty rows — never a 500. `tab_records` is resolved separately through the
 * record store, so it is listed here too. The CI coverage test asserts the
 * union of `RESOURCE_TABLE` keys + this set covers every `PortalQueryResource`,
 * so a NEW resource cannot silently fall through to empty without a decision.
 */
export const INTENTIONALLY_UNMAPPED_RESOURCES: ReadonlySet<PortalQueryResource> =
  new Set<PortalQueryResource>([
    'royalty_returns',
    'treasury_accounts',
    'compliance_obligations',
    'shipments',
    'subsidiaries',
    'tab_records',
  ]);

// ────────────────────────────────────────────────────────────────────
// READ-ONLY tool allow-set. The vetted `PORTAL_TOOL_IDS` are a MIX of
// read-only (export/aggregate) and mutating (create_*/request_*/notify_*)
// actions. A widget-data read is a RENDER path, so ONLY these read-only ids may
// ever dispatch; a mutating tool is asserted out BEFORE any port call and
// returns empty rows. This set is the single trust boundary — adding a read
// tool means adding both its registry id and one entry here, never loosening
// the check. NEVER add a tool that writes / moves money / mutates an entity.
// ────────────────────────────────────────────────────────────────────

const READ_ONLY_TOOL: ReadonlySet<PortalToolId> = new Set<PortalToolId>([
  'export_records',
  'recompute_royalty_estimate',
]);

/** True when `id` is a vetted READ-ONLY tool — safe to dispatch from a read. */
function isReadOnlyTool(id: PortalToolId): boolean {
  return READ_ONLY_TOOL.has(id);
}

// ────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────

export function createWidgetDataResolver(
  deps: WidgetDataResolverDeps,
): WidgetDataResolver {
  const { query, recordStore, logger } = deps;

  // The READ-ONLY tool-dispatch port. Injected one wins; otherwise compose the
  // default generic port from the same `query` port the query path uses (it
  // honest-degrades to empty rows when no DB is wired). `resolveTool` is the
  // gate — the port only ever sees an allow-listed read-only tool.
  const toolPort: ReadOnlyToolPort =
    deps.toolPort ??
    createDefaultReadOnlyToolPort({
      ...(query !== undefined ? { query } : {}),
      logger,
    });

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
    orderByColumn: string,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData> {
    if (!query) {
      // No DB wired (dev/test/smoke) — honest empty, never crash.
      return { rows: [] };
    }
    try {
      const rows = await query.query<Record<string, unknown>>(
        // `table` + `orderByColumn` are allow-listed constants from
        // RESOURCE_TABLE / RESOURCE_ORDER_BY — never user input — so the
        // identifier interpolation is safe. The tenant predicate is
        // parameterised; RLS FORCE is the DB-side backstop.
        `SELECT * FROM public.${table} WHERE tenant_id = $1 ORDER BY ${orderByColumn} DESC LIMIT $2`,
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
      // Known-but-unmapped — honest empty rows, never a 500. If this resource is
      // NOT deliberately unmapped, it is a genuine wiring gap: run the
      // self-healing loop to recognise it as an `unmapped-binding` blocker and
      // escalate a human-gated proposal to the internal-admin console, then
      // PROCEED with empty rows so the customer is still served in the moment.
      if (
        deps.onBlocker &&
        !INTENTIONALLY_UNMAPPED_RESOURCES.has(resource as PortalQueryResource)
      ) {
        attemptHeal(
          {
            kind: 'unmapped-binding',
            locus: `widget.resource/${resource}`,
            detail:
              'resource is known but has no table mapping and is not deliberately unmapped',
          },
          { report: deps.onBlocker },
        );
      }
      return { rows: [] };
    }
    // Resolve the recency column: the per-resource override when present
    // (production_records → `ts`), else the `created_at` default.
    const orderByColumn =
      RESOURCE_ORDER_BY[resource as PortalQueryResource] ??
      DEFAULT_ORDER_BY_COLUMN;
    return resolveMappedTable(table, orderByColumn, ctx);
  }

  async function resolveTool(
    toolId: string,
    args: Readonly<Record<string, unknown>> | undefined,
    ctx: WidgetResolveContext,
  ): Promise<WidgetData> {
    if (!isKnownTool(toolId)) {
      logger.warn({ toolId }, 'widget-data: unknown tool id — rejecting');
      throw new UnknownBindingError(`unknown tool '${toolId}'`);
    }
    // Hard gate: a render-time widget read may dispatch ONLY a read-only tool. A
    // mutating tool (create_*/request_*/notify_*) is NEVER executed here — it
    // degrades to empty rows + a warn so a generated binding can never write,
    // move money, or mutate an entity from a read path.
    if (!isReadOnlyTool(toolId)) {
      logger.warn(
        { toolId },
        'widget-data: tool is not read-only — refusing to execute, empty rows',
      );
      return { rows: [] };
    }
    // Read-only → dispatch against the injected (or default generic) port. Any
    // port failure is already degraded inside the port to empty rows; we wrap
    // again so a thrown port can never 500 the request.
    try {
      return await toolPort.runReadTool(toolId, args, ctx);
    } catch (err) {
      logger.warn(
        { toolId, err: errMessage(err) },
        'widget-data: read-tool dispatch threw — degrading to empty rows',
      );
      return { rows: [] };
    }
  }

  return {
    async resolve(
      binding: ResolvableBinding,
      ctx: WidgetResolveContext,
    ): Promise<WidgetData> {
      if (binding.kind === 'query') {
        return resolveQuery(binding.resource, ctx);
      }
      return resolveTool(binding.toolId, binding.args, ctx);
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
