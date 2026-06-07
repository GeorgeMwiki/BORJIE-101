/**
 * recordActivationEvent — fail-soft writer for the product activation FUNNEL.
 *
 * The internal-admin analytics screen (apps/admin-web/src/app/internal/
 * analytics) aggregates `activation_events` into a funnel + cohort view. This
 * helper is the single instrumentation point milestone handlers call to APPEND
 * one event per real product milestone (signup completed, licence created,
 * first sale/royalty, onboarding complete, …).
 *
 * HARD CONSTRAINT — FAIL-SOFT (CLAUDE.md / task): an analytics write must NEVER
 * break the product flow it instruments. Every path here swallows its own
 * errors (logged via Pino) and resolves; callers do NOT await-throw. The write
 * is best-effort fire-and-forget — callers may `void recordActivationEvent(...)`
 * without awaiting, OR await it (it never rejects).
 *
 * RLS: the `db` handed in is the request-scoped, tenant-pinned Drizzle client
 * (`c.get('db')` after databaseMiddleware bound `app.current_tenant_id`). The
 * insert therefore lands under the caller's tenant RLS policy; we additionally
 * stamp `tenantId` on the row for defence-in-depth. NEVER call this with a raw
 * unpinned client.
 *
 * Immutability: `activation_events` is append-only — this helper only ever
 * INSERTs; nothing here updates or deletes.
 */

import { activationEvents } from '@borjie/database';
import { z } from 'zod';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('activation-events');

/**
 * Canonical milestone slugs. Kept as a const tuple so the funnel route and the
 * instrumentation call-sites agree on the vocabulary. `recordActivationEvent`
 * accepts any non-empty string (forward-compat for new milestones), but using
 * a member of this set keeps the funnel ordering meaningful.
 */
export const ACTIVATION_EVENT_TYPES = [
  'signup_completed',
  'licence_created',
  'first_sale_recorded',
  'first_royalty_paid',
  'onboarding_completed',
] as const;

export type ActivationEventType = (typeof ACTIVATION_EVENT_TYPES)[number];

/**
 * Minimal structural shape of the tenant-pinned Drizzle client this helper
 * needs. Declared locally (rather than importing the full DatabaseClient type)
 * so the helper stays decoupled from the gateway's database-middleware type
 * derivation and is trivially stubbable in unit tests.
 */
export interface ActivationEventDb {
  readonly insert: (table: unknown) => {
    readonly values: (row: unknown) => Promise<unknown>;
  };
}

/** Runtime guard on the event payload — props must be a plain JSON object. */
const PropsSchema = z.record(z.unknown());

export interface RecordActivationEventInput {
  readonly db: ActivationEventDb | null | undefined;
  readonly tenantId: string;
  readonly eventType: string;
  readonly actorId?: string | null;
  readonly props?: Readonly<Record<string, unknown>>;
}

/**
 * Append one activation-funnel event. Resolves to `true` when the row was
 * written, `false` when it was skipped or the write failed — NEVER throws.
 *
 * @example
 *   // inside a milestone handler, after the real work has succeeded:
 *   void recordActivationEvent({
 *     db: c.get('db'),
 *     tenantId,
 *     eventType: 'licence_created',
 *     actorId: userId,
 *     props: { licenceId: row.id, kind: row.kind },
 *   });
 */
export async function recordActivationEvent(
  input: RecordActivationEventInput,
): Promise<boolean> {
  const { db, tenantId, eventType, actorId, props } = input;

  // Guard inputs WITHOUT throwing — a bad call must not break the caller.
  if (!db || typeof db.insert !== 'function') {
    moduleLogger.warn('activation event skipped: no db', { eventType });
    return false;
  }
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    moduleLogger.warn('activation event skipped: missing tenantId', {
      eventType,
    });
    return false;
  }
  if (typeof eventType !== 'string' || eventType.length === 0) {
    moduleLogger.warn('activation event skipped: missing eventType', {
      tenantId,
    });
    return false;
  }

  const safeProps = (() => {
    const parsed = PropsSchema.safeParse(props ?? {});
    return parsed.success ? parsed.data : {};
  })();

  try {
    await db.insert(activationEvents).values({
      tenantId,
      eventType,
      actorId: actorId ?? null,
      props: safeProps,
    });
    return true;
  } catch (err) {
    // FAIL-SOFT: log loud, swallow. The instrumented flow continues.
    moduleLogger.error('activation event write failed', {
      evt: 'activation_event_write_failed',
      eventType,
      tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
