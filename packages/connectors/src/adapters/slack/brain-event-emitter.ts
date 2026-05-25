/**
 * Slack → Brain Event Bus emitter.
 *
 * Wave-2 task #11.3 in `.audit/litfin-sota-2026-05-23/00-EXECUTION-ROADMAP.md`.
 * Research report: `.audit/litfin-sota-2026-05-23/11-company-brain-primitive.md`.
 *
 * Emits `comms.slack.inbound` brain events for every actionable inbound
 * Slack event (channel message, DM, app-mention). Mirrors the
 * WhatsApp brain emitter at
 * `services/notifications/src/whatsapp/brain/whatsapp-brain-emitter.ts`,
 * adapted for the Slack channel model:
 *
 *   - WhatsApp DMs map 1:1 onto Slack `im` channels (ACL =
 *     [sender, recipient]).
 *   - WhatsApp groups map 1:1 onto Slack `mpim` / private `group`
 *     channels (ACL = [all members captured at ingest time]).
 *   - Slack adds a third axis WhatsApp doesn't have: public channels.
 *     For those the ACL uses `roleIds = [tenantAllMembersRoleId]`
 *     instead of an inlined member list — the retriever expands the
 *     role against live tenant membership at query time.
 *
 * ACL is captured at ingest time, never post-filtered (Glean / Onyx
 * "permission-aware ingestion"). Stale member snapshots = potential
 * leak; the ACL resolver always re-resolves on every event rather
 * than caching.
 *
 * Tenant isolation: this emitter is constructed PER tenant install.
 * The bound `tenantId` is checked against the inbound event's
 * `team_id` on every call; mismatches are dropped + logged.
 *
 * Bus contract: errors swallow + log. The webhook handler returns
 * 200-OK to Slack regardless of brain-bus health — Slack will retry
 * if we 500, and we don't want a downstream consumer outage to
 * trigger that. (Slack retries up to 3 times; idempotency is the
 * consumer's responsibility, keyed by `event_id`.)
 */

import type { SlackAclResolver } from './acl-resolver.js';
import { mineMessagePattern } from './decision-pattern-miner.js';
import type {
  BrainEvent,
  BrainEventACL,
  BrainEventPublisher,
  SlackAppMentionEvent,
  SlackEvent,
  SlackEventCallbackEnvelope,
  SlackMessageEvent,
  SlackReactionAddedEvent,
  SlackTenantInstall,
  SlackUserResolver,
} from './types.js';

// ============================================================================
// Options
// ============================================================================

export interface SlackBrainEventEmitterOptions {
  /**
   * Per-tenant install. Binds the emitter's tenant scope; mismatched
   * inbound `team_id` is dropped + logged.
   */
  readonly install: SlackTenantInstall;
  /** Bus publisher — same instance the consumers subscribe against. */
  readonly publisher: BrainEventPublisher;
  /**
   * ACL resolver. Constructed per-tenant by the composition root and
   * shared with this emitter. The resolver owns the
   * `tenantAllMembersRoleId` (read via `getTenantAllMembersRoleId()`).
   */
  readonly aclResolver: SlackAclResolver;
  /**
   * Slack workspace user id → platform user id resolver. When
   * omitted, the emitter falls back to `slack:<teamId>:<slackUserId>`
   * as the user id — keeps the bus tracker honest while a downstream
   * re-tag step can later join slack-uid → platform-uid.
   */
  readonly userResolver?: SlackUserResolver;
  /**
   * Optional logger. When omitted the emitter is silent (matches the
   * existing WhatsApp emitter's tolerant stance).
   */
  readonly logger?: {
    warn(obj: Record<string, unknown>, msg?: string): void;
  };
}

// ============================================================================
// Implementation
// ============================================================================

export class SlackBrainEventEmitter {
  private readonly install: SlackTenantInstall;
  private readonly publisher: BrainEventPublisher;
  private readonly aclResolver: SlackAclResolver;
  private readonly userResolver?: SlackUserResolver;
  private readonly logger?: SlackBrainEventEmitterOptions['logger'];

  constructor(options: SlackBrainEventEmitterOptions) {
    this.install = options.install;
    this.publisher = options.publisher;
    this.aclResolver = options.aclResolver;
    if (options.userResolver) {
      this.userResolver = options.userResolver;
    }
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  /**
   * Process a verified Slack `event_callback` envelope. Caller is
   * responsible for signature verification BEFORE invoking this
   * method (the signature-verifier module handles that).
   *
   * Returns the number of brain events successfully published. Errors
   * are swallowed + logged.
   */
  async emitFromEnvelope(envelope: SlackEventCallbackEnvelope): Promise<number> {
    try {
      // Tenant isolation: `team_id` MUST match the bound install.
      if (envelope.team_id !== this.install.teamId) {
        this.logger?.warn(
          {
            envelopeTeam: envelope.team_id,
            installTeam: this.install.teamId,
            eventType: envelope.event.type,
          },
          'slack-brain-emitter: cross-tenant envelope; refusing',
        );
        return 0;
      }

      return await this.dispatchEvent(envelope.event, envelope.event_time);
    } catch (error) {
      this.logger?.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          eventType: envelope.event.type,
          eventId: envelope.event_id,
        },
        'slack-brain-emitter: emit failed (swallowed)',
      );
      return 0;
    }
  }

  // ============================================================================
  // Private — per-event-type dispatch
  // ============================================================================

  private async dispatchEvent(
    event: SlackEvent,
    eventTime: number,
  ): Promise<number> {
    switch (event.type) {
      case 'message':
        return this.emitMessage(event, eventTime);
      case 'reaction_added':
        return this.emitReaction(event, eventTime);
      case 'app_mention':
        return this.emitAppMention(event, eventTime);
      default: {
        // Exhaustiveness check — TS will error here if a new event
        // type is added to the union without a handler.
        const _exhaustive: never = event;
        void _exhaustive;
        return 0;
      }
    }
  }

  private async emitMessage(
    event: SlackMessageEvent,
    eventTime: number,
  ): Promise<number> {
    // Skip bot messages (incl. our own bot's echoes).
    if (event.bot_id) return 0;
    // Skip our own bot's user id when present (covers user-token
    // messages from the bot user).
    if (event.user && this.install.botUserId && event.user === this.install.botUserId) {
      return 0;
    }
    // Skip ephemeral subtypes we don't care about for v1.
    if (event.subtype && event.subtype !== 'file_share') {
      return 0;
    }

    const acl = await this.buildAcl(event.channel);
    const actorId = await this.resolveActor(event.user);
    const minedPattern = mineMessagePattern(event.text);

    const brainEvent: BrainEvent = {
      type: 'comms.slack.inbound',
      tenantId: this.install.tenantId,
      ...(actorId ? { actorId } : {}),
      payload: {
        slackEventType: 'message',
        channel: event.channel,
        channelType: event.channel_type ?? 'channel',
        ts: event.ts,
        ...(event.thread_ts ? { threadTs: event.thread_ts } : {}),
        ...(event.text ? { text: event.text } : {}),
        ...(event.subtype ? { subtype: event.subtype } : {}),
        ...(event.blocks ? { blocks: event.blocks } : {}),
        teamId: this.install.teamId,
        recognisedIntent: minedPattern.intent,
        intentConfidence: minedPattern.confidence,
        intentTriggerKeywords: minedPattern.triggerKeywords,
        ...(minedPattern.chiSquared !== undefined
          ? { intentChiSquared: minedPattern.chiSquared }
          : {}),
      } as Readonly<Record<string, unknown>>,
      acl,
      observedAt: secondsToDate(eventTime),
      sourceSystem: 'slack',
    };

    await this.publisher.publish(brainEvent);
    return 1;
  }

  private async emitReaction(
    event: SlackReactionAddedEvent,
    eventTime: number,
  ): Promise<number> {
    // Skip reactions FROM our own bot.
    if (this.install.botUserId && event.user === this.install.botUserId) {
      return 0;
    }
    // Only message reactions emit brain events for v1.
    if (event.item.type !== 'message') return 0;

    const acl = await this.buildAcl(event.item.channel);
    const actorId = await this.resolveActor(event.user);

    const brainEvent: BrainEvent = {
      type: 'comms.slack.inbound',
      tenantId: this.install.tenantId,
      ...(actorId ? { actorId } : {}),
      ...(event.item.ts ? { subjectId: `${event.item.channel}:${event.item.ts}` } : {}),
      payload: {
        slackEventType: 'reaction_added',
        reaction: event.reaction,
        targetChannel: event.item.channel,
        targetTs: event.item.ts,
        ...(event.item_user ? { targetUser: event.item_user } : {}),
        teamId: this.install.teamId,
      } as Readonly<Record<string, unknown>>,
      acl,
      observedAt: secondsToDate(Number.parseFloat(event.event_ts) || eventTime),
      sourceSystem: 'slack',
    };

    await this.publisher.publish(brainEvent);
    return 1;
  }

  private async emitAppMention(
    event: SlackAppMentionEvent,
    eventTime: number,
  ): Promise<number> {
    // Skip self-mentions (the bot mentioning itself somehow).
    if (this.install.botUserId && event.user === this.install.botUserId) {
      return 0;
    }

    const acl = await this.buildAcl(event.channel);
    const actorId = await this.resolveActor(event.user);
    const minedPattern = mineMessagePattern(event.text);

    const brainEvent: BrainEvent = {
      type: 'comms.slack.inbound',
      tenantId: this.install.tenantId,
      ...(actorId ? { actorId } : {}),
      payload: {
        slackEventType: 'app_mention',
        channel: event.channel,
        ts: event.ts,
        ...(event.thread_ts ? { threadTs: event.thread_ts } : {}),
        text: event.text,
        teamId: this.install.teamId,
        recognisedIntent: minedPattern.intent,
        intentConfidence: minedPattern.confidence,
        intentTriggerKeywords: minedPattern.triggerKeywords,
        ...(minedPattern.chiSquared !== undefined
          ? { intentChiSquared: minedPattern.chiSquared }
          : {}),
      } as Readonly<Record<string, unknown>>,
      acl,
      observedAt: secondsToDate(eventTime),
      sourceSystem: 'slack',
    };

    await this.publisher.publish(brainEvent);
    return 1;
  }

  // ============================================================================
  // Private — ACL + identity helpers
  // ============================================================================

  /**
   * Resolve a Slack channel id to a brain-bus ACL envelope.
   *
   * For DMs (`im`) / group-DMs (`mpim`) / private channels (`group`)
   * the ACL is the full member list, captured live from the API. For
   * public channels (`channel`) the ACL uses the tenant
   * "all-members" roleId via role-based expansion at query time.
   */
  private async buildAcl(channelId: string): Promise<BrainEventACL> {
    const channelAcl = await this.aclResolver.resolve({
      tenantId: this.install.tenantId,
      channelId,
    });

    if (channelAcl.isPublic) {
      const roleId = this.aclResolver.getTenantAllMembersRoleId();
      return {
        userIds: [],
        roleIds: roleId ? [roleId] : [],
      };
    }

    // DM / group-DM / private channel: inline member list.
    return {
      userIds: dedupe(channelAcl.members),
      roleIds: [],
    };
  }

  /**
   * Map a Slack workspace user id to the platform user id. Falls
   * back to a `slack:<teamId>:<slackUserId>` synthetic identity when
   * no resolver is wired or when resolution returns null — keeps the
   * bus tracker honest (no silent identity loss).
   */
  private async resolveActor(slackUserId: string | undefined): Promise<string | null> {
    if (!slackUserId) return null;

    if (this.userResolver) {
      try {
        const resolved = await this.userResolver.resolveUserId({
          tenantId: this.install.tenantId,
          slackUserId,
        });
        if (resolved) return resolved;
      } catch (error) {
        this.logger?.warn(
          {
            slackUserId,
            err: error instanceof Error ? error.message : String(error),
          },
          'slack-brain-emitter: userResolver failed; falling back to synthetic id',
        );
      }
    }

    return `slack:${this.install.teamId}:${slackUserId}`;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function dedupe(ids: ReadonlyArray<string>): ReadonlyArray<string> {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
}

function secondsToDate(unixSeconds: number): Date {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return new Date();
  return new Date(unixSeconds * 1000);
}

/** Factory function for composition root wiring. */
export function createSlackBrainEventEmitter(
  options: SlackBrainEventEmitterOptions,
): SlackBrainEventEmitter {
  return new SlackBrainEventEmitter(options);
}
