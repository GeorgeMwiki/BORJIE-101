/**
 * Saved-search worker composition — Roadmap R2.
 *
 * The pure worker in
 * `services/api-gateway/src/workers/saved-search-worker.ts` speaks an
 * opaque op-envelope protocol over three injected ports
 * (`DbLike` / `SearchExecutor` / `OwnerAlertSender`) so its unit tests
 * can drive every branch without a live Postgres. This module builds the
 * REAL ports against the live Drizzle client so the worker actually
 * fires owner saved-search alerts once it is started from the boot
 * sequence (the worker was previously built + tested but never composed,
 * so the alerts never fired).
 *
 * Port mapping:
 *   - DbLike          two op envelopes → real SQL over `saved_searches`
 *                     (select-due + update-after-run).
 *   - SearchExecutor  counts live rows in the row's source corpus
 *                     (marketplace_listings | request_for_bids |
 *                     regulatory_zones), degrading to 0 on an unknown
 *                     source so a typo never throws the tick.
 *   - OwnerAlertSender writes a durable `reminders` row, idempotency-keyed
 *                     per (tenant, key), so the already-running
 *                     reminders-dispatch worker delivers the alert through
 *                     the existing email / SMS / Slack pipeline. The
 *                     deterministic key (`saved-search-alert:<id>:<count>`)
 *                     makes the same match-count delta fire at most once.
 *
 * Pure + dependency-injected: the only surface area is the Drizzle client
 * + an optional clock + logger, so this composition is itself unit
 * testable without a live PG.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { withServiceRoleContext } from '@borjie/database';
import type {
  DbLike,
  OwnerAlertSender,
  SavedSearchFrequency,
  SavedSearchRow,
  SearchExecutor,
} from '../workers/saved-search-worker.js';

// withServiceRoleContext's db param type (derived to dodge the TS2709 clash
// between the @borjie/database DatabaseClient and the local DrizzleLike port).
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

// ---------------------------------------------------------------------------
// Drizzle client port — only `execute` is needed.
// ---------------------------------------------------------------------------

export interface DrizzleLike {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

function asFrequency(value: unknown): SavedSearchFrequency {
  return value === 'hourly' || value === 'weekly'
    ? value
    : 'daily';
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DbLike adapter — translates the worker's op envelopes into real SQL.
// ---------------------------------------------------------------------------

interface SelectDueOp {
  readonly __op: 'select_due_saved_searches';
  readonly at: string;
}

interface UpdateAfterRunOp {
  readonly __op: 'update_saved_search_after_run';
  readonly id: string;
  readonly tenantId: string;
  readonly lastRunAt: string;
  readonly lastMatchCount: number;
  readonly alerted: boolean;
}

function isSelectDueOp(op: unknown): op is SelectDueOp {
  return (
    typeof op === 'object' &&
    op !== null &&
    (op as { __op?: unknown }).__op === 'select_due_saved_searches'
  );
}

function isUpdateAfterRunOp(op: unknown): op is UpdateAfterRunOp {
  return (
    typeof op === 'object' &&
    op !== null &&
    (op as { __op?: unknown }).__op === 'update_saved_search_after_run'
  );
}

/**
 * Build the worker's `DbLike` port over the real Drizzle client. Reads
 * only ENABLED rows (`disabled_at IS NULL`) so a paused saved search
 * never re-fires.
 *
 * The `select_due` drain scans `saved_searches` CROSS-TENANT (no tenant
 * predicate) over the shared pool, so under FORCE ROW LEVEL SECURITY it must
 * bind `app.is_service_role='true'` (migration 0365's
 * `saved_searches_service_role_bypass`) or the scan matches ZERO rows and the
 * entire owner-alert loop goes silently dark. Wrap when the client is
 * transaction-capable; the unit-test mock (a bare `{ execute }` stub) executes
 * directly. The `update_after_run` op is tenant-keyed (`WHERE tenant_id = …`)
 * and stays on the request-shaped predicate — it never needs the bypass.
 */
export function createSavedSearchDbAdapter(db: DrizzleLike): DbLike {
  // Run a statement under a service-role context so the cross-tenant
  // `select_due` drain survives FORCE RLS. Mirrors the reminders-dispatch
  // worker's runStmt: only the transaction-capable production client gets the
  // wrap; the test stub (no `.transaction`) executes directly.
  function runServiceRole(query: unknown): Promise<unknown> {
    const dbAny = db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withServiceRoleContext(db as unknown as ServiceRoleDb, (tx) =>
        (tx as unknown as DrizzleLike).execute(query),
      );
    }
    return db.execute(query);
  }

  return Object.freeze({
    async execute(query: unknown): Promise<unknown> {
      if (isSelectDueOp(query)) {
        const result = await runServiceRole(sql`
          SELECT id, tenant_id, user_id, label, query_json,
                 frequency, source, last_run_at, last_match_count
            FROM saved_searches
           WHERE disabled_at IS NULL
        `);
        return rowsOf(result).map((row) =>
          Object.freeze<SavedSearchRow>({
            id: String(row['id']),
            tenantId: String(row['tenant_id']),
            userId: String(row['user_id']),
            label: String(row['label']),
            queryJson:
              typeof row['query_json'] === 'object' && row['query_json'] !== null
                ? (row['query_json'] as Record<string, unknown>)
                : {},
            frequency: asFrequency(row['frequency']),
            source: String(row['source']),
            lastRunAt: asDate(row['last_run_at']),
            lastMatchCount: Number(row['last_match_count'] ?? 0) || 0,
          }),
        );
      }

      if (isUpdateAfterRunOp(query)) {
        await db.execute(sql`
          UPDATE saved_searches
             SET last_run_at = ${query.lastRunAt},
                 last_match_count = ${query.lastMatchCount},
                 last_alert_at = ${
                   query.alerted ? sql`${query.lastRunAt}` : sql`last_alert_at`
                 },
                 updated_at = now()
           WHERE id = ${query.id}
             AND tenant_id = ${query.tenantId}
        `);
        return [];
      }

      // Unknown envelope — never reached from the worker, but fail safe.
      return [];
    },
  });
}

// ---------------------------------------------------------------------------
// SearchExecutor — counts live rows in the row's source corpus.
// ---------------------------------------------------------------------------

/**
 * Build the worker's `SearchExecutor`. Each source maps to a tenant-
 * scoped count over its live corpus. An unrecognised source degrades to
 * 0 (never throws) so a future / mistyped source never poisons the tick.
 */
export function createSavedSearchExecutor(db: DrizzleLike): SearchExecutor {
  return Object.freeze({
    async run(args: {
      readonly tenantId: string;
      readonly source: string;
      readonly query: Record<string, unknown>;
    }): Promise<{ readonly matchCount: number }> {
      const count = await (async (): Promise<number> => {
        switch (args.source) {
          case 'marketplace': {
            const rows = rowsOf(
              await db.execute(sql`
                SELECT count(*)::int AS n
                  FROM marketplace_listings
                 WHERE tenant_id = ${args.tenantId}
                   AND status = 'active'
              `),
            );
            return Number(rows[0]?.['n'] ?? 0) || 0;
          }
          case 'opportunities': {
            const rows = rowsOf(
              await db.execute(sql`
                SELECT count(*)::int AS n
                  FROM request_for_bids
                 WHERE tenant_id = ${args.tenantId}
                   AND status = 'open'
              `),
            );
            return Number(rows[0]?.['n'] ?? 0) || 0;
          }
          case 'regulatory': {
            // regulatory_zones is tenant-agnostic ground truth (NULL
            // tenant); "live" = no active_until or it has not lapsed.
            const rows = rowsOf(
              await db.execute(sql`
                SELECT count(*)::int AS n
                  FROM regulatory_zones
                 WHERE active_until IS NULL
                    OR active_until >= now()
              `),
            );
            return Number(rows[0]?.['n'] ?? 0) || 0;
          }
          default:
            return 0;
        }
      })();
      return { matchCount: count };
    },
  });
}

// ---------------------------------------------------------------------------
// OwnerAlertSender — writes a durable, idempotent reminders row.
// ---------------------------------------------------------------------------

const ALERT_LEAD_MS = 0;

/**
 * Build the worker's `OwnerAlertSender`. Persists one `reminders` row
 * (status `scheduled`, channel `email`) so the running reminders-dispatch
 * worker delivers it through the existing provider pipeline. The
 * worker's deterministic idempotency key + the UNIQUE
 * (tenant_id, idempotency_key) index make every match-count delta fire at
 * most once.
 */
export function createSavedSearchAlertSender(
  db: DrizzleLike,
  opts?: { readonly now?: () => Date; readonly logger?: Logger },
): OwnerAlertSender {
  const now = opts?.now ?? (() => new Date());
  const logger = opts?.logger;
  return Object.freeze({
    async send(args: {
      readonly tenantId: string;
      readonly userId: string;
      readonly savedSearch: SavedSearchRow;
      readonly newMatches: number;
      readonly idempotencyKey: string;
    }): Promise<{ readonly delivered: boolean }> {
      const triggerAt = new Date(now().getTime() + ALERT_LEAD_MS).toISOString();
      const title = `New matches: ${args.savedSearch.label}`;
      const body = `${args.newMatches} new result${
        args.newMatches === 1 ? '' : 's'
      } matched your saved search "${args.savedSearch.label}".`;
      try {
        const result = await db.execute(sql`
          INSERT INTO reminders (
            tenant_id, owner_id, title, body, trigger_at,
            channel, status, payload, idempotency_key
          )
          VALUES (
            ${args.tenantId},
            ${args.userId},
            ${title},
            ${body},
            ${triggerAt},
            'email',
            'scheduled',
            ${JSON.stringify({
              kind: 'saved_search_alert',
              savedSearchId: args.savedSearch.id,
              source: args.savedSearch.source,
              newMatches: args.newMatches,
            })}::jsonb,
            ${args.idempotencyKey}
          )
          ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
          RETURNING id
        `);
        const inserted = rowsOf(result).length > 0;
        return { delivered: inserted };
      } catch (err) {
        logger?.error(
          {
            err,
            savedSearchId: args.savedSearch.id,
            tenantId: args.tenantId,
          },
          'saved-search alert persist failed',
        );
        return { delivered: false };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience — build the full worker port bundle in one call.
// ---------------------------------------------------------------------------

export interface SavedSearchWorkerPorts {
  readonly db: DbLike;
  readonly search: SearchExecutor;
  readonly alerts: OwnerAlertSender;
}

/**
 * Compose all three real ports from a single Drizzle client. The boot
 * sequence passes the result straight into `createSavedSearchWorker(...)`.
 */
export function buildSavedSearchWorkerPorts(
  db: DrizzleLike,
  opts?: { readonly now?: () => Date; readonly logger?: Logger },
): SavedSearchWorkerPorts {
  return Object.freeze({
    db: createSavedSearchDbAdapter(db),
    search: createSavedSearchExecutor(db),
    alerts: createSavedSearchAlertSender(db, opts),
  });
}
