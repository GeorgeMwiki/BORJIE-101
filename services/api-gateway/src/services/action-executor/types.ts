/**
 * Action-executor types — the chat→action execution bridge.
 *
 * Mr. Mwikila's cockpit chat (`/api/v1/brain/teach`) emits action chips
 * (`auto_authorized`, `micro_action_card`, `confirmation_card`). Until
 * this module landed those chips were advisory-only: NOTHING executed.
 *
 * The executor is a typed registry mapping an action `verb` → an async
 * handler that performs ONE real, persisted, tenant-scoped side effect
 * and returns a structured result. It is invoked ONLY after the
 * fail-closed `decideAutoAuthorization` gate authorizes the verb — the
 * executor itself never decides authorization (separation of concerns).
 *
 * HARD RULES honoured (see CLAUDE.md):
 *   - RLS is FORCE-enabled: handlers rely on the `app.current_tenant_id`
 *     GUC bound by `databaseMiddleware`. They filter by the per-row
 *     dimension (e.g. `owner_id`) but NEVER double-filter tenant in a way
 *     that bypasses RLS, and never disable RLS.
 *   - Money path NEVER written here — only via LedgerService. The SAFE
 *     verb set is reminders-only by construction; money / ledger / hire /
 *     licence / site verbs are explicitly out of scope for this wave.
 *   - No `console.log` — callers pass a Pino logger via the context.
 */

import type { createDatabaseClient } from '@borjie/database';

/**
 * Drizzle client handle. Derived via `ReturnType` to dodge the
 * `TS2709 namespace-vs-type` barrel drift that bites `DatabaseClient`
 * at this consumption site (same pattern as superpowers-dispatchers.ts
 * and db-client.ts).
 */
export type ExecDbClient = ReturnType<typeof createDatabaseClient>;

/**
 * Minimal Pino-shaped logger. We accept the structural subset the
 * handlers use so a test can pass a stub without the full Pino surface.
 */
export interface ExecLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

/**
 * Execution context threaded into every handler. Carries the verified
 * tenant + user (resolved upstream from the RLS-bound JWT principal) and
 * the Drizzle client whose connection already has `app.current_tenant_id`
 * set, so handler writes are tenant-scoped by RLS.
 */
export interface ExecContext {
  readonly db: ExecDbClient;
  readonly tenantId: string;
  readonly userId: string;
  readonly logger: ExecLogger;
}

/**
 * Structured result of a successful execution. `kind` names the artifact
 * class (e.g. `reminder`) and `id` is the persisted row id when one
 * exists. `data` carries a small, FE-renderable summary — never the full
 * row, never anything sensitive.
 */
export interface ExecResult {
  readonly kind: string;
  readonly id?: string;
  readonly summary: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * A handler performs one real persisted side effect. Input is the raw,
 * un-validated params object the chat / FE supplied — every handler
 * MUST zod-validate it before touching the database, throwing on
 * invalid input. Throwing is fine: the dispatcher catches and converts
 * to a graceful `{ executed:false }` envelope at the call site.
 */
export type ActionHandler = (
  input: unknown,
  ctx: ExecContext,
) => Promise<ExecResult>;

/**
 * Outcome of dispatching a verb through the registry. `executed:false`
 * with `reason:'unknown_action'` is returned for an unregistered verb —
 * the dispatcher NEVER throws for an unknown verb (graceful by design).
 */
export type DispatchResult =
  | { readonly executed: true; readonly result: ExecResult }
  | { readonly executed: false; readonly reason: string };
