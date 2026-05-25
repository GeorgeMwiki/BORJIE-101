/**
 * Announcement Drizzle adapter — backs the HQ-tier
 * `platform.send_announcement` tool (Central Command Phase B — B1,
 * TIER 2). Migration 0139.
 *
 * Writes to `platform_announcements` and (when supplied) triggers the
 * actual delivery via an optional `NotificationDispatchPort`. The
 * existing notification-dispatch service lives in api-gateway
 * (`services/api-gateway/src/services/notification-dispatch/`); to keep
 * this package dependency-free, we accept the dispatcher as a
 * structural port — when omitted, the announcement row is queued and
 * delivery becomes the composition root's responsibility (cron sweep,
 * separate worker, etc.).
 *
 * Lifecycle:
 *   queued    — row inserted, awaiting send
 *   sending   — dispatcher acknowledged but not yet confirmed
 *   sent      — fully fanned out
 *   retracted — rollback executed; recipients receive a retraction
 *
 * Recipient cardinality is computed at send-time by an injected
 * resolver; tests inject a constant.
 */
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { platformAnnouncements } from '../../schemas/platform-announcements.schema.js';
import type { DatabaseClient } from '../../client.js';
import { logger } from '../../logger.js';

export type AnnouncementChannel = 'banner' | 'email' | 'both';

export interface SendAnnouncementArgs {
  readonly scope: 'global' | `tenant:${string}`;
  readonly channel: AnnouncementChannel;
  readonly subject: string;
  readonly body: string;
  readonly scheduleAt: string | null;
}

export interface SendAnnouncementResult {
  readonly announcementId: string;
  readonly scope: 'global' | `tenant:${string}`;
  readonly channel: AnnouncementChannel;
  readonly subject: string;
  readonly recipientCount: number;
  readonly scheduledFor: string;
  readonly status: 'queued' | 'sending' | 'sent';
}

export interface RecallAnnouncementArgs {
  readonly announcementId: string;
  readonly reason: string;
}

export interface PlatformAnnouncementService {
  send(args: SendAnnouncementArgs): Promise<SendAnnouncementResult>;
  recall(args: RecallAnnouncementArgs): Promise<void>;
}

/**
 * Structural dispatcher port — composition root wires the real
 * notification-dispatch service against this shape. When omitted, the
 * adapter just queues; the row's `status` stays `queued`.
 */
export interface NotificationDispatcherLike {
  dispatch(args: {
    readonly announcementId: string;
    readonly scope: 'global' | `tenant:${string}`;
    readonly channel: AnnouncementChannel;
    readonly subject: string;
    readonly body: string;
    readonly scheduleAt: string | null;
  }): Promise<{ readonly recipientCount: number; readonly status: 'sending' | 'sent' }>;
  retract(args: {
    readonly announcementId: string;
    readonly reason: string;
  }): Promise<void>;
}

/**
 * Structural recipient-resolver — composition root counts how many
 * recipients a given scope+channel pair would reach. We don't compile-
 * time depend on the audience service; tests inject a constant.
 */
export interface RecipientResolverLike {
  count(args: {
    readonly scope: 'global' | `tenant:${string}`;
    readonly channel: AnnouncementChannel;
  }): Promise<number>;
}

export interface AnnouncementDeps {
  /** Caller id for `created_by`. */
  readonly resolveActor: () => string;
  /** Optional dispatcher; when omitted the row is queued only. */
  readonly dispatcher?: NotificationDispatcherLike;
  /** Optional recipient counter; defaults to 0. */
  readonly recipientResolver?: RecipientResolverLike;
}

export function createPlatformAnnouncementService(
  db: DatabaseClient,
  deps: AnnouncementDeps,
): PlatformAnnouncementService {
  return {
    async send(args) {
      const id = randomUUID();
      const now = new Date();
      const scheduledFor = args.scheduleAt
        ? new Date(args.scheduleAt)
        : now;
      const recipientCount = deps.recipientResolver
        ? await deps.recipientResolver
            .count({ scope: args.scope, channel: args.channel })
            .catch((err) => {
              logger.error('platform.announcements.recipientResolver failed', { error: err });
              return 0;
            })
        : 0;

      try {
        await db.insert(platformAnnouncements).values({
          id,
          scope: args.scope,
          channel: args.channel,
          subject: args.subject,
          body: args.body,
          recipientCount,
          scheduledFor,
          status: 'queued',
          createdAt: now,
          createdBy: deps.resolveActor(),
        } as never);
      } catch (error) {
        logger.error('platform.announcements.send insert failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.announcements.send insert failed');
      }

      let status: 'queued' | 'sending' | 'sent' = 'queued';
      if (deps.dispatcher) {
        try {
          const dispatchOut = await deps.dispatcher.dispatch({
            announcementId: id,
            scope: args.scope,
            channel: args.channel,
            subject: args.subject,
            body: args.body,
            scheduleAt: args.scheduleAt,
          });
          status = dispatchOut.status;
          // Reflect dispatcher's true recipient count (the resolver above
          // was a best-effort pre-check; the dispatcher knows the real
          // fan-out after expansion).
          const realRecipientCount =
            typeof dispatchOut.recipientCount === 'number'
              ? dispatchOut.recipientCount
              : recipientCount;
          await db
            .update(platformAnnouncements)
            .set({
              status,
              recipientCount: realRecipientCount,
            } as never)
            .where(eq(platformAnnouncements.id, id));
          return {
            announcementId: id,
            scope: args.scope,
            channel: args.channel,
            subject: args.subject,
            recipientCount: realRecipientCount,
            scheduledFor: scheduledFor.toISOString(),
            status,
          };
        } catch (error) {
          // Dispatcher failure: row stays `queued`; operator will
          // notice and intervene. We do NOT rethrow so the audit row
          // remains visible.
          logger.error('platform.announcements.dispatch failed', { error: error });
        }
      }
      return {
        announcementId: id,
        scope: args.scope,
        channel: args.channel,
        subject: args.subject,
        recipientCount,
        scheduledFor: scheduledFor.toISOString(),
        status,
      };
    },

    async recall(args) {
      if (!args.announcementId) {
        throw new Error(
          'platform.announcements.recall: announcementId is required',
        );
      }
      const now = new Date();
      try {
        await db
          .update(platformAnnouncements)
          .set({
            status: 'retracted',
            retractedAt: now,
            retractedReason: args.reason,
          } as never)
          .where(eq(platformAnnouncements.id, args.announcementId));
        if (deps.dispatcher) {
          try {
            await deps.dispatcher.retract({
              announcementId: args.announcementId,
              reason: args.reason,
            });
          } catch (error) {
            // The DB row is already marked retracted; the dispatcher
            // can resync on a follow-up sweep. Log + swallow.
            logger.error('platform.announcements.recall dispatcher failed', { error: error });
          }
        }
      } catch (error) {
        logger.error('platform.announcements.recall update failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.announcements.recall failed');
      }
    },
  };
}
