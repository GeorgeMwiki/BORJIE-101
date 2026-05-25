/**
 * LLM-budget store wiring (P76 BUG-HI-3 closure).
 *
 * The in-memory `BudgetStore` kept per-tenant LLM spend in the api-gateway
 * process heap. On restart (deploy, OOM kill, scale-down) every tenant's
 * daily budget reset to zero — tenants got unlimited LLM spend until the
 * in-memory counter rebuilt. P80 shipped `createPostgresBudgetStore` in
 * `@borjie/llm-budget-governor`; this helper picks the right adapter
 * at composition time:
 *
 *   - LIVE mode (`db` is non-null): `createPostgresBudgetStore({ db })`.
 *     Persists per-tenant usage to `tenant_llm_budgets`; caps live in
 *     `tenant_llm_budget_caps` (migration `0272_tenant_llm_budgets.sql`).
 *   - DEGRADED mode (`db` is null): `createInMemoryBudgetStore()`. Logs
 *     a single warning so operators know spend won't persist across
 *     restarts in degraded mode.
 *
 * The postgres-store package consumes a tagged-template `SqlClient` port
 * (structurally compatible with `postgres-js`'s `Sql` handle). Drizzle on
 * postgres-js exposes that handle via `db.$client`, so we forward it as
 * the SQL port without importing `postgres` here.
 */
// `DatabaseClient` from `@borjie/database` collides with a
// `drizzle-orm/postgres-js` declaration-merged namespace, so we derive
// the type locally (same workaround `agency-port-bindings.ts` uses).
import { createDatabaseClient } from '@borjie/database';
import {
  createInMemoryBudgetStore,
  createPostgresBudgetStore,
  type BudgetStore,
  type BudgetStoreSqlClient,
} from '@borjie/llm-budget-governor';

type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * Minimal logger duck-type used by this helper. The api-gateway
 * composition root constructs short-lived loggers per call-site (`pino`
 * is bound globally inside `index.ts`); we accept the duck-shape here
 * to avoid pulling a hard pino dependency into the wiring file.
 */
export interface BudgetStoreLogger {
  readonly warn?: (meta: object, msg?: string) => void;
}

export interface WireBudgetStoreArgs {
  /** Drizzle client (null in degraded mode). */
  readonly db: DatabaseClient | null;
  /** Optional structured logger. When unset the helper stays silent. */
  readonly logger?: BudgetStoreLogger;
}

/**
 * Pick the right `BudgetStore` adapter for the current registry mode.
 *
 * Live mode → Postgres-backed (caps survive restarts).
 * Degraded mode → in-memory (resets on restart — operator warned once).
 */
export function wireBudgetStore(args: WireBudgetStoreArgs): BudgetStore {
  const { db, logger } = args;
  if (db !== null) {
    // `postgres-js`'s `Sql` handle is structurally compatible with the
    // tagged-template `SqlClient` port the postgres-store consumes.
    // Drizzle exposes it via `$client`; the cast is the one boundary
    // between the Drizzle namespace shape and the duck-typed SQL port.
    const sql = (db as unknown as { $client: BudgetStoreSqlClient }).$client;
    return createPostgresBudgetStore({ db: sql });
  }
  logger?.warn?.(
    { where: 'llm-budget-postgres-wiring' },
    'DATABASE_URL unset — using in-memory budget store (resets on restart; tenants get unlimited spend until then)',
  );
  return createInMemoryBudgetStore();
}
