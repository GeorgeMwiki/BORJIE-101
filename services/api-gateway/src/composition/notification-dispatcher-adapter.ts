/**
 * Notification dispatcher + recipient resolver adapters (Central
 * Command Phase C — C2).
 *
 * Closes B1 TODOs #3 + #4: the platform `announcement.service.ts`
 * factory accepts two optional ports — a `NotificationDispatcherLike`
 * for actual fan-out and a `RecipientResolverLike` for the at-rest
 * recipient count. This module wires both from the composition root's
 * concrete dependencies.
 *
 * Dispatcher design:
 *   - The adapter publishes onto TWO surfaces:
 *       1. the in-process EventBus so any subscribed worker (e.g. a
 *          future broadcast-fanout worker that expands one announcement
 *          row into N `notification_dispatch_log` rows) receives the
 *          event;
 *       2. the cross-portal bus so every running brain / portal SSE
 *          stream picks up the banner / notification in real time.
 *   - We do NOT directly insert per-recipient `notification_dispatch_log`
 *     rows in this adapter — that pipeline expands a (scope, audience)
 *     pair into N rows and is owned by a separate worker. Until that
 *     worker lands, banner-channel announcements still fan out via SSE
 *     (cross-portal bus) and the audit row is queued in
 *     `platform_announcements`. Email/SMS channels are queued + visible
 *     in the admin UI; the worker is a follow-up.
 *   - Both publish steps swallow + log failures. Announcement DB row is
 *     the source of truth (B1's adapter already persists it before
 *     calling `dispatch`).
 *
 * Recipient resolver design:
 *   - `scope === 'global'`  → count users with `status = 'active'`
 *     across every tenant in `status = 'active'`.
 *   - `scope === 'tenant:<id>'` → count active users in that tenant.
 *   - `channel === 'banner'` does NOT require an email address — banner
 *     fan-out is via SSE/in-app, every active user is a candidate.
 *   - `channel === 'email' | 'both'` requires a non-null email; we
 *     filter accordingly so the count reflects the realistic fan-out.
 *   - DB failures return `0` (the count is best-effort; B1's adapter
 *     stamps `recipientCount = 0` on resolver failure and continues).
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  createDatabaseClient,
  tenants,
  users,
} from '@borjie/database';
import {
  globalTopic,
  tenantTopic,
  type CrossPortalBus,
} from './cross-portal-bus.js';

// `DatabaseClient` resolves as a namespace when pulled through the
// package barrel under NodeNext (TS2709) — derive from the factory.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

// ─────────────────────────────────────────────────────────────────────
// Structural EventBus port — keeps this file free of a compile-time
// dependency on `@borjie/domain-services`'s event-bus class. The
// composition root passes the live bus; tests inject a spy.
// ─────────────────────────────────────────────────────────────────────

/**
 * Permissive event-bus port. We accept ANY envelope shape so that this
 * adapter is compatible with both:
 *   1. The real `EventBus` from `@borjie/domain-services` whose
 *      `publish<T extends DomainEvent>(EventEnvelope<T>): Promise<void>`
 *      shape carries a richer typed payload.
 *   2. Lightweight in-test spies that just want `{type, payload}`.
 *
 * The adapter internally builds a normalised envelope and passes it
 * through. Callers downstream of this port should not rely on a
 * specific envelope shape.
 */
export interface EventBusLike {
  publish(envelope: unknown): void | Promise<void>;
}

export interface NotificationDispatcherAdapterLogger {
  readonly info?: (meta: Record<string, unknown>, msg: string) => void;
  readonly warn?: (meta: Record<string, unknown>, msg: string) => void;
}

// ─────────────────────────────────────────────────────────────────────
// Dispatcher adapter
// ─────────────────────────────────────────────────────────────────────

export type AnnouncementChannel = 'banner' | 'email' | 'both';

export interface DispatchArgs {
  readonly announcementId: string;
  readonly scope: 'global' | `tenant:${string}`;
  readonly channel: AnnouncementChannel;
  readonly subject: string;
  readonly body: string;
  readonly scheduleAt: string | null;
}

export interface DispatchResult {
  readonly recipientCount: number;
  readonly status: 'sending' | 'sent';
}

export interface RetractArgs {
  readonly announcementId: string;
  readonly reason: string;
}

/**
 * Structural port — mirrors `NotificationDispatcherLike` in
 * `packages/database/src/services/platform/announcement.service.ts`.
 * Exported so callers can type-check the adapter at the wiring site.
 */
export interface NotificationDispatcherLike {
  dispatch(args: DispatchArgs): Promise<DispatchResult>;
  retract(args: RetractArgs): Promise<void>;
}

export interface CreateNotificationDispatcherAdapterDeps {
  /** Optional Drizzle client — currently unused at the dispatch site
   *  (the adapter relies on bus + event fanout) but accepted so future
   *  per-recipient insertion can land without a signature break. */
  readonly db?: DatabaseClient | null;
  readonly eventBus: EventBusLike;
  /** Cross-portal bus (Promise<CrossPortalBus> — see
   *  `cross-portal-bus.ts`). The adapter awaits once + caches. */
  readonly crossPortalBus: Promise<CrossPortalBus>;
  readonly logger?: NotificationDispatcherAdapterLogger;
  /** Override clock (tests). */
  readonly clock?: () => Date;
}

function isTenantScope(
  scope: 'global' | `tenant:${string}`,
): scope is `tenant:${string}` {
  return scope.startsWith('tenant:');
}

function tenantIdFromScope(scope: `tenant:${string}`): string {
  return scope.slice('tenant:'.length);
}

/**
 * Build the dispatcher adapter wired into B1's
 * `PlatformAnnouncementService.dispatcher` slot.
 *
 * Returns a `NotificationDispatcherLike` whose `dispatch()` publishes
 * onto the event bus + cross-portal bus, and whose `retract()` mirrors
 * the same fan-out path with a retraction payload. Recipient counts
 * are passed through unchanged — B1's adapter pre-resolves via the
 * recipient resolver and the dispatcher only needs to ack the send.
 */
export function createNotificationDispatcherAdapter(
  deps: CreateNotificationDispatcherAdapterDeps,
): NotificationDispatcherLike {
  const clock = deps.clock ?? (() => new Date());
  // Resolve the bus once. Caching the promise lets concurrent first
  // dispatch calls share the resolution.
  let busPromise: Promise<CrossPortalBus | null> | null = null;
  function resolveBusOnce(): Promise<CrossPortalBus | null> {
    if (busPromise) return busPromise;
    busPromise = deps.crossPortalBus
      .then((bus) => bus)
      .catch((err: unknown) => {
        deps.logger?.warn?.(
          {
            err: err instanceof Error ? err.message : String(err),
            wiring: 'notification-dispatcher-adapter',
          },
          'announcement-dispatch: bus resolution failed — cross-portal fan-out disabled',
        );
        return null;
      });
    return busPromise;
  }

  async function publishToCrossPortal(args: {
    scope: 'global' | `tenant:${string}`;
    kind: 'announcement' | 'notification';
    payload: Record<string, unknown>;
  }): Promise<void> {
    const bus = await resolveBusOnce();
    if (!bus) return;
    try {
      const topic = isTenantScope(args.scope)
        ? tenantTopic(tenantIdFromScope(args.scope))
        : globalTopic();
      await bus.publish(topic, {
        kind: args.kind,
        payload: args.payload,
        emittedBy: 'hq:announcements',
        emittedAt: clock().toISOString(),
      });
    } catch (err) {
      deps.logger?.warn?.(
        {
          err: err instanceof Error ? err.message : String(err),
          scope: args.scope,
          wiring: 'notification-dispatcher-adapter',
        },
        'announcement-dispatch: cross-portal publish failed (audit row still persisted)',
      );
    }
  }

  function publishToEventBus(type: string, payload: Record<string, unknown>): void {
    try {
      void deps.eventBus.publish({ type, payload });
    } catch (err) {
      deps.logger?.warn?.(
        {
          err: err instanceof Error ? err.message : String(err),
          type,
          wiring: 'notification-dispatcher-adapter',
        },
        'announcement-dispatch: event-bus publish failed (cross-portal still attempted)',
      );
    }
  }

  return {
    async dispatch(args: DispatchArgs): Promise<DispatchResult> {
      // Best-effort dual publish — both surfaces are independent.
      publishToEventBus('platform.announcement.dispatched', {
        announcementId: args.announcementId,
        scope: args.scope,
        channel: args.channel,
        subject: args.subject,
        scheduleAt: args.scheduleAt,
        emittedAt: clock().toISOString(),
      });
      await publishToCrossPortal({
        scope: args.scope,
        kind: 'announcement',
        payload: {
          announcementId: args.announcementId,
          scope: args.scope,
          channel: args.channel,
          subject: args.subject,
          body: args.body,
          scheduleAt: args.scheduleAt,
        },
      });
      // The realtime banner is "sending" until the per-recipient
      // worker confirms email/SMS delivery (follow-up). For banner-
      // only fan-out the SSE push IS the delivery, so we still report
      // `sending` here to keep the audit row's lifecycle truthful — the
      // status promotes to `sent` after the worker confirms.
      return { recipientCount: 0, status: 'sending' };
    },

    async retract(args: RetractArgs): Promise<void> {
      publishToEventBus('platform.announcement.retracted', {
        announcementId: args.announcementId,
        reason: args.reason,
        emittedAt: clock().toISOString(),
      });
      await publishToCrossPortal({
        // Retractions land globally — every receiver of the original
        // announcement must remove the banner. We don't know the
        // original scope from the retract args; the recall route's
        // payload carries the announcementId and consumers correlate.
        scope: 'global',
        kind: 'notification',
        payload: {
          type: 'announcement-retracted',
          announcementId: args.announcementId,
          reason: args.reason,
        },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Recipient resolver adapter
// ─────────────────────────────────────────────────────────────────────

export interface RecipientCountArgs {
  readonly scope: 'global' | `tenant:${string}`;
  readonly channel: AnnouncementChannel;
}

/**
 * Structural port — mirrors `RecipientResolverLike` in
 * `packages/database/src/services/platform/announcement.service.ts`.
 */
export interface RecipientResolverLike {
  count(args: RecipientCountArgs): Promise<number>;
}

export interface CreateRecipientResolverAdapterDeps {
  readonly db: DatabaseClient;
  readonly logger?: NotificationDispatcherAdapterLogger;
}

/**
 * Build a Drizzle-backed recipient counter for B1's announcement
 * service. The resolver:
 *   - global → counts active users across active tenants;
 *   - tenant:<id> → counts active users on that tenant;
 *   - email-channel filters to users with a non-null email;
 *   - banner channel has no email gating.
 *
 * All DB failures return 0 — the count is best-effort and B1's adapter
 * tolerates a zero count by stamping `recipientCount = 0`.
 */
export function createRecipientResolverAdapter(
  deps: CreateRecipientResolverAdapterDeps,
): RecipientResolverLike {
  return {
    async count(args: RecipientCountArgs): Promise<number> {
      try {
        const requiresEmail = args.channel === 'email' || args.channel === 'both';
        if (isTenantScope(args.scope)) {
          const tenantId = tenantIdFromScope(args.scope);
          if (!tenantId) return 0;
          const whereTenant = and(
            eq(users.tenantId, tenantId),
            eq(users.status, 'active'),
            requiresEmail
              ? (sql`${users.email} IS NOT NULL AND length(${users.email}) > 0` as never)
              : undefined,
          );
          const rows = (await deps.db
            .select({ c: sql<number>`count(*)::int` })
            .from(users)
            .where(whereTenant as never)) as ReadonlyArray<{ c: number }>;
          return rows[0]?.c ?? 0;
        }

        // Global scope — count active users across active tenants.
        const whereGlobal = and(
          eq(users.status, 'active'),
          eq(tenants.status, 'active'),
          requiresEmail
            ? (sql`${users.email} IS NOT NULL AND length(${users.email}) > 0` as never)
            : undefined,
        );
        const rows = (await deps.db
          .select({ c: sql<number>`count(*)::int` })
          .from(users)
          .innerJoin(tenants, eq(users.tenantId, tenants.id))
          .where(whereGlobal as never)) as ReadonlyArray<{ c: number }>;
        return rows[0]?.c ?? 0;
      } catch (err) {
        deps.logger?.warn?.(
          {
            err: err instanceof Error ? err.message : String(err),
            scope: args.scope,
            channel: args.channel,
            wiring: 'recipient-resolver-adapter',
          },
          'recipient-resolver: count failed — returning 0',
        );
        return 0;
      }
    },
  };
}
