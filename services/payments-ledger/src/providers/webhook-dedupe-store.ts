/**
 * Durable webhook idempotency store (EDGE-HARDENING #3).
 *
 * WHY THIS EXISTS
 * ---------------
 * Duplicate-webhook suppression used to live in a per-process in-memory
 * `Set<string>` inside each provider handler. That set is lost on restart
 * and is NOT shared across replicas, so a redelivered Stripe/M-Pesa event
 * after a deploy (or hitting a different pod) re-processed → double-credit
 * of the immutable ledger. Safaricom + Stripe both deliver AT-LEAST-ONCE
 * and retry for days, so this window was real money.
 *
 * THE FIX — claim-after-commit dedupe (mirrors `journal_idempotency`)
 * -------------------------------------------------------------------
 * A durable `webhook_events (provider, event_id, tenant_id, received_at)`
 * table with PRIMARY KEY (provider, event_id). On receipt we INSERT the
 * event id; a unique-violation (SQLSTATE 23505) means DUPLICATE → the
 * caller acks 200 and skips processing; a clean insert means FIRST SIGHT →
 * process. The claim is the authoritative cross-replica guard.
 *
 * DEFENCE IN DEPTH
 * ----------------
 * The webhook claim and the `LedgerService.postJournalEntry` happen on
 * different DB connections, so a crash strictly between (claim committed)
 * and (ledger posted) could in principle drop the side effect. We close
 * that gap by ALSO passing the provider event id as the ledger post's
 * `idempotencyKey` (durability defect #2): the ledger is post-once on that
 * key regardless of the webhook claim. So the two layers together give:
 *   - claim present, ledger present  → normal duplicate, skip.
 *   - claim present, ledger absent   → crash mid-process; the redelivery
 *     is skipped by the claim, BUT a manual/reconciliation replay (which
 *     bypasses the claim) still posts exactly once via the ledger key.
 *   - claim absent  (store outage)   → handler falls back to processing;
 *     the ledger idempotency key still prevents a double-post.
 * No path double-credits.
 *
 * HARD RULES honoured: tenant-scoped + RLS (migration 0163, FORCE RLS on
 * `app.current_tenant_id`), Pino logging only, no money columns here.
 */

import { and, eq, sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { DatabaseClient } from '@borjie/database';

/**
 * Provider discriminator for the dedupe key namespace. Keeps a Stripe
 * `evt_…` id from ever colliding with an M-Pesa `ws_CO_…` id.
 */
export type WebhookProvider = 'stripe' | 'mpesa';

/**
 * The claim outcome. `first-seen` → the caller proceeds to process the
 * side effect. `duplicate` → the caller acks 200 and does NOTHING.
 */
export type WebhookClaim = 'first-seen' | 'duplicate';

/**
 * Durable webhook dedupe port. The single method ATOMICALLY claims an
 * event id: it returns `first-seen` exactly once per (provider, eventId)
 * and `duplicate` for every subsequent claim — across restarts and
 * replicas when backed by the database.
 *
 * The claim MUST be committed before (or in the same transaction as) the
 * side effect it guards, so a crash cannot both-claim-and-lose. Callers
 * additionally key the ledger post on the same event id for belt-and-
 * suspenders post-once safety.
 */
export interface WebhookDedupeStore {
  claim(
    provider: WebhookProvider,
    eventId: string,
    tenantId: string,
  ): Promise<WebhookClaim>;
}

/**
 * Process-local Map-backed store. Survives neither restart nor a second
 * replica — dev/test only. Production wires {@link DbWebhookDedupeStore}
 * via the factory when `DATABASE_URL` is set.
 */
export class InMemoryWebhookDedupeStore implements WebhookDedupeStore {
  private readonly seen = new Set<string>();

  async claim(
    provider: WebhookProvider,
    eventId: string,
    _tenantId: string,
  ): Promise<WebhookClaim> {
    const key = `${provider}:${eventId}`;
    if (this.seen.has(key)) return 'duplicate';
    this.seen.add(key);
    return 'first-seen';
  }
}

// ---------------------------------------------------------------------------
// Database-backed store (webhook_events — migration 0163)
// ---------------------------------------------------------------------------

/**
 * Local Drizzle declaration of the `webhook_events` table. Mirrors the
 * `journal_idempotency` pattern in `drizzle-ledger-entry.repository.ts`:
 * declared module-internally so its inferred type stays in this unit, with
 * column-name parity to migration 0163. PRIMARY KEY (provider, event_id)
 * supplies the UNIQUE guarantee the dedupe relies on; `tenant_id` carries
 * the RLS predicate.
 */
const webhookEvents = pgTable('webhook_events', {
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505).
 * postgres-js surfaces the SQLSTATE on `error.code`. A 23505 on the
 * (provider, event_id) PK means a concurrent or prior delivery already
 * claimed this event → DUPLICATE.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

/**
 * Minimal Pino-shaped logger so this module never reaches for `console`.
 */
interface DedupeLogger {
  warn: (ctx: unknown, msg: string) => void;
}

/**
 * Database-backed durable dedupe. The claim is a single INSERT bound to
 * the tenant's RLS context inside ONE transaction; a 23505 means the row
 * already existed → `duplicate`. The insert COMMITS before the caller runs
 * its side effect, so a crash after the claim cannot resurrect the event
 * as first-seen on redelivery (the redelivery hits the existing row).
 */
export class DbWebhookDedupeStore implements WebhookDedupeStore {
  constructor(
    private readonly db: DatabaseClient,
    private readonly logger?: DedupeLogger,
  ) {}

  async claim(
    provider: WebhookProvider,
    eventId: string,
    tenantId: string,
  ): Promise<WebhookClaim> {
    try {
      await (
        this.db as unknown as {
          transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
        }
      ).transaction(async (tx) => {
        const txDb = tx as DatabaseClient;
        // Bind the tenant RLS GUC TRANSACTION-LOCALLY as the first
        // statement. FORCE RLS on webhook_events evaluates
        //   tenant_id = current_setting('app.current_tenant_id', true)
        // so without this the INSERT fails closed under the app role. The
        // `true` third arg scopes the binding to this tx (no pooled leak).
        // Mirror the legacy `app.tenant_id` name for older helpers, as the
        // ledger repo does.
        await txDb.execute(
          sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
        );
        await txDb.execute(
          sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
        );
        await txDb.insert(webhookEvents).values({
          provider,
          eventId,
          tenantId,
        });
      });
      return 'first-seen';
    } catch (err) {
      if (isUniqueViolation(err)) {
        return 'duplicate';
      }
      // A non-23505 failure (e.g. DB unreachable) must NOT silently
      // suppress the event. Surface loud and fall back to first-seen so
      // the caller still processes; the ledger idempotency key keyed on
      // the same event id remains the post-once backstop. Re-throwing here
      // would 5xx the webhook and trigger an at-least-once retry storm.
      this.logger?.warn(
        { err, provider, eventId },
        'webhook dedupe claim failed (non-unique error); processing with ledger-key backstop',
      );
      return 'first-seen';
    }
  }

  /**
   * Test/ops helper — has this event been claimed? Tenant-scoped read
   * bound to the RLS GUC. Not on the hot path.
   */
  async exists(
    provider: WebhookProvider,
    eventId: string,
    tenantId: string,
  ): Promise<boolean> {
    const rows = await (
      this.db as unknown as {
        transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
      }
    ).transaction(async (tx) => {
      const txDb = tx as DatabaseClient;
      await txDb.execute(
        sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
      );
      await txDb.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );
      return txDb
        .select({ eventId: webhookEvents.eventId })
        .from(webhookEvents)
        .where(
          and(
            eq(webhookEvents.provider, provider),
            eq(webhookEvents.eventId, eventId),
          ),
        )
        .limit(1);
    });
    return rows.length > 0;
  }
}

/**
 * Build the durable dedupe store. When `db` is provided (production,
 * `DATABASE_URL` set) returns the {@link DbWebhookDedupeStore}; otherwise
 * the in-memory adapter for dev/test. Tests construct adapters directly.
 */
export function createWebhookDedupeStore(input: {
  db?: DatabaseClient | null;
  logger?: DedupeLogger;
}): WebhookDedupeStore {
  if (input.db) {
    return new DbWebhookDedupeStore(input.db, input.logger);
  }
  return new InMemoryWebhookDedupeStore();
}
