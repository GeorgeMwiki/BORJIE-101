/**
 * WhatsApp → Brain Event Bus emitter.
 *
 * Wave-2 task #10 of `.audit/litfin-sota-2026-05-23/00-EXECUTION-ROADMAP.md`.
 * Research report: `.audit/litfin-sota-2026-05-23/11-company-brain-primitive.md`.
 *
 * Captures ~85% of EA tenant communications (per the research report's
 * connector matrix — WhatsApp Cloud API is the dominant comms channel
 * in KE/TZ) by fanning out every inbound message into a brain-event
 * bus that consumers (consolidation-worker, work-graph indexer, skill
 * miner) subscribe to.
 *
 * # ACL design (Glean/Onyx "permission-aware ingestion")
 *
 * The brain bus's defining contract is that ACL is captured **at
 * ingest time, from the source system, alongside content** — never
 * post-filtered. For WhatsApp:
 *
 *   - **1:1 DM (Meta Cloud API direct webhook):**
 *       `userIds = [senderUserId, recipientUserId]`
 *       `roleIds = []`
 *     Two principals, no roles. Resolved via `TenantLookup.findByPhone`
 *     on both ends; unresolved phone numbers fall through to an empty
 *     `actorId` and the event lands quarantined (empty userIds set)
 *     until a downstream re-tag step links it to an identity.
 *
 *   - **Group chat (multi-device / Business Suite groups):**
 *       `userIds = [...allGroupMemberUserIds]`
 *       `roleIds = []`
 *     The full member list is captured at webhook time via the
 *     supplied `GroupMembershipLookup`. Membership snapshots **must**
 *     be resolved synchronously — late lookups risk a member-removed-
 *     since race that would leak the message to an ex-member.
 *
 *   - **Broadcast list (one-to-many, sender-controlled):**
 *       `userIds = [senderUserId, ...broadcastRecipientUserIds]`
 *       `roleIds = []`
 *     Broadcast lists are sender-private (the recipients don't see
 *     each other), so each recipient gets the event tagged with only
 *     themselves + the sender, NOT the full list. This is the only
 *     case where the emitter produces **multiple** events per
 *     inbound webhook message.
 *
 *   - **Unknown / unattributed (anonymous webhook noise):**
 *       `userIds = []`
 *       `roleIds = []`
 *     Quarantined — no principal may read until downstream re-tag.
 *
 * # Tenant isolation
 *
 * `tenantId` is non-empty on every emitted event. If
 * `TenantLookup.findByPhone(sender)` returns null AND the recipient
 * cannot be resolved either, the emitter SKIPS the event (with a
 * warn log) rather than emit a tenantless event that would be
 * rejected by the bus. This is intentional: an inbound webhook the
 * platform can't attribute to a tenant has no business landing on
 * the brain bus.
 *
 * # Signature verification
 *
 * This module does NOT bypass signature verification. The
 * `webhook-router.ts` middleware (`validateWebhookSignature`) runs
 * BEFORE the message reaches this emitter; signature failure → 401
 * response → emitter never sees the payload.
 */

import type { TenantLookup } from '../conversation-orchestrator.js';
import type { IncomingMessage } from '../types.js';

// ============================================================================
// Brain bus contract — local duck-type
// ============================================================================
//
// The notifications service currently has zero `@borjie/*`
// workspace deps. Adding one for a single type would balloon the
// install graph (ai-copilot pulls @anthropic-ai/sdk, openai,
// isolated-vm, jose, zod, …). Instead we duck-type the brain bus
// contract locally — same shape, same field names, same semantics as
// `packages/ai-copilot/src/brain-event-bus/types.ts`. The composition
// root passes a runtime instance that satisfies both contracts.
//
// IMPORTANT: keep this shape in sync with the canonical types module
// at `packages/ai-copilot/src/brain-event-bus/types.ts`. The two are
// structurally compatible by design (TS structural typing) — any
// drift here is a bug.
// ============================================================================

/** ACL envelope. Mirrors `BrainEventACL` from the canonical module. */
export interface BrainEventACL {
  readonly userIds: ReadonlyArray<string>;
  readonly roleIds: ReadonlyArray<string>;
}

/** Source system discriminator. */
export type BrainEventSource =
  | 'whatsapp'
  | 'slack'
  | 'gmail'
  | 'outlook'
  | 'mpesa'
  | 'sms'
  | 'voice'
  | 'webhook'
  | 'system';

/** Brain event envelope. Mirrors `BrainEvent` from the canonical module. */
export interface BrainEvent<TPayload = Readonly<Record<string, unknown>>> {
  readonly type: string;
  readonly tenantId: string;
  readonly actorId?: string;
  readonly subjectId?: string;
  readonly payload: TPayload;
  readonly acl: BrainEventACL;
  readonly observedAt: Date;
  readonly sourceSystem: BrainEventSource;
}

/** Publisher contract. Single `publish` method — minimal by design. */
export interface BrainEventPublisher {
  publish(event: BrainEvent): Promise<void>;
}

// ============================================================================
// Lookup contracts — supplied by the composition root
// ============================================================================

/**
 * Identity resolver for a WhatsApp `wa_id` (E.164 phone number).
 *
 * Returns the platform user id (NOT the tenant id) that the phone
 * number is registered to. Used to populate the `userIds` ACL list.
 *
 * Implementations typically wrap the same lookup the
 * `TenantLookup.findByPhone` uses (the tenant lookup returns a
 * `TenantInfo` containing `tenantId`; this lookup returns the actual
 * platform user). When omitted in the wiring, the emitter falls back
 * to the phone number itself — which keeps the bus tracker honest
 * (no silent identity loss) at the cost of read-time joins being
 * phone-keyed rather than user-keyed.
 */
export interface WhatsAppUserResolver {
  resolveUserIdForPhone(phoneNumber: string): Promise<string | null>;
}

/**
 * Group-membership resolver. Required when the platform supports
 * inbound group messages (WhatsApp Business Suite / multi-device).
 * The single-tenant Meta Cloud API webhook does NOT carry group
 * metadata, so this is only wired by the Business Suite ingest
 * adapter (out of scope for v1 — left as an interface so the
 * Business Suite shim can drop in without touching this module).
 */
export interface WhatsAppGroupMembershipLookup {
  /**
   * Return the list of platform user ids that are members of the
   * given WhatsApp group. MUST be a fresh read at the moment of the
   * webhook — caching is the caller's responsibility.
   */
  listMembers(groupId: string): Promise<ReadonlyArray<string>>;
}

/**
 * Broadcast-list recipient resolver. Used when an outbound broadcast
 * triggers an inbound reply that the platform wants to attribute back
 * to the original broadcast cohort. v1 does NOT emit broadcast
 * events from the inbound webhook (Meta's Cloud API doesn't expose
 * broadcast-list metadata on inbound messages anyway), so this is a
 * forward-looking interface only.
 */
export interface WhatsAppBroadcastRecipientLookup {
  listRecipients(broadcastListId: string): Promise<ReadonlyArray<string>>;
}

// ============================================================================
// Webhook envelope shape carried into the emitter
// ============================================================================

/**
 * Per-message context the webhook router hands to the emitter. The
 * shape is deliberately minimal — the emitter does NOT introspect the
 * full `WhatsAppWebhookPayload` (that's the router's job).
 */
export interface WhatsAppInboundContext {
  /** The parsed Meta IncomingMessage. */
  readonly message: IncomingMessage;
  /**
   * Display name from the contacts block, when present. Used only
   * for the payload's human-readable hint, NOT for ACL.
   */
  readonly senderName?: string;
  /**
   * Platform recipient — the BORJIE user id that owns the
   * WhatsApp Business phone number that received this message. When
   * omitted, the emitter falls back to the configured
   * `businessRecipientUserId` (typically a tenant-scoped service
   * account).
   */
  readonly recipientUserId?: string;
  /**
   * For group / broadcast messages: the WhatsApp group id. Meta's
   * Cloud API does not surface group metadata on inbound webhook
   * messages today, so this is forward-looking and only populated by
   * the Business Suite shim.
   */
  readonly groupId?: string;
  /**
   * For broadcast-list inbound replies: the broadcast list id.
   */
  readonly broadcastListId?: string;
}

// ============================================================================
// Emitter options
// ============================================================================

export interface WhatsAppBrainEmitterOptions {
  /**
   * Bus publisher. The composition root supplies the live bus (in v1
   * always the in-memory bus from
   * `@borjie/ai-copilot/brain-event-bus`); tests supply a mock.
   */
  readonly publisher: BrainEventPublisher;
  /**
   * Tenant lookup — re-used from the orchestrator wiring so the
   * emitter doesn't introduce a second tenant-resolution path. MUST
   * be the same instance the router passes to the orchestrator (or a
   * functional equivalent backed by the same store) to avoid the
   * cross-handler split-brain bug where the orchestrator believes
   * the sender is tenant A and the emitter believes tenant B.
   */
  readonly tenantLookup: Pick<TenantLookup, 'findByPhone'>;
  /**
   * Phone → platform user id resolver. Optional — when omitted, the
   * emitter falls back to the phone number itself as the user id.
   */
  readonly userResolver?: WhatsAppUserResolver;
  /**
   * Default platform user id for the business-side recipient. Used
   * when the per-call `WhatsAppInboundContext.recipientUserId` is
   * omitted (i.e. all messages on this WhatsApp number share the
   * same business-side owner).
   */
  readonly businessRecipientUserId?: string;
  /**
   * Group membership resolver. Required only when inbound group
   * messages are emitted (Business Suite adapter); v1 Cloud API
   * webhooks never carry groupId so this stays unwired.
   */
  readonly groupMembershipLookup?: WhatsAppGroupMembershipLookup;
  /**
   * Broadcast recipient resolver. Forward-looking only.
   */
  readonly broadcastRecipientLookup?: WhatsAppBroadcastRecipientLookup;
  /**
   * Optional logger. When omitted the emitter is silent on warn
   * conditions (matches the existing webhook router's tolerant
   * stance: never throw out of the webhook handler).
   */
  readonly logger?: {
    warn(obj: Record<string, unknown>, msg?: string): void;
  };
}

// ============================================================================
// Emitter implementation
// ============================================================================

export class WhatsAppBrainEmitter {
  private readonly publisher: BrainEventPublisher;
  private readonly tenantLookup: Pick<TenantLookup, 'findByPhone'>;
  private readonly userResolver?: WhatsAppUserResolver;
  private readonly businessRecipientUserId?: string;
  private readonly groupMembershipLookup?: WhatsAppGroupMembershipLookup;
  private readonly broadcastRecipientLookup?: WhatsAppBroadcastRecipientLookup;
  private readonly logger?: WhatsAppBrainEmitterOptions['logger'];

  constructor(options: WhatsAppBrainEmitterOptions) {
    this.publisher = options.publisher;
    this.tenantLookup = options.tenantLookup;
    if (options.userResolver) {
      this.userResolver = options.userResolver;
    }
    if (options.businessRecipientUserId) {
      this.businessRecipientUserId = options.businessRecipientUserId;
    }
    if (options.groupMembershipLookup) {
      this.groupMembershipLookup = options.groupMembershipLookup;
    }
    if (options.broadcastRecipientLookup) {
      this.broadcastRecipientLookup = options.broadcastRecipientLookup;
    }
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  /**
   * Emit a `comms.whatsapp.inbound` event for a single webhook
   * message. Called by the webhook router AFTER the existing
   * processing path has been kicked off (never blocks the orchestrator
   * — both run concurrently on microtasks).
   *
   * Broadcast messages fan out into N events (one per recipient) so
   * each recipient's view of the bus only contains messages
   * addressed to them.
   *
   * Returns the number of events successfully published. Errors are
   * logged + swallowed — the webhook router must remain 200-OK for
   * Meta's retry timer regardless of brain-bus health.
   */
  async emitInbound(context: WhatsAppInboundContext): Promise<number> {
    try {
      const tenant = await this.tenantLookup.findByPhone(context.message.from);
      // Tenant isolation: if neither side resolves to a tenant, we
      // refuse to put the event on the bus.
      if (!tenant?.tenantId) {
        this.logger?.warn(
          {
            messageId: context.message.id,
            from: context.message.from,
          },
          'whatsapp-brain-emitter: skipping event — sender phone unresolved to any tenant',
        );
        return 0;
      }

      const senderUserId = await this.resolveSenderUserId(context.message.from);
      const recipientUserId =
        context.recipientUserId ?? this.businessRecipientUserId;

      // Discriminate DM vs group vs broadcast vs unattributed.
      if (context.broadcastListId && this.broadcastRecipientLookup) {
        return await this.emitBroadcast(context, tenant.tenantId, senderUserId);
      }

      if (context.groupId && this.groupMembershipLookup) {
        return await this.emitGroup(
          context,
          tenant.tenantId,
          senderUserId,
        );
      }

      // Default: 1:1 DM.
      return await this.emitDirect(
        context,
        tenant.tenantId,
        senderUserId,
        recipientUserId,
      );
    } catch (error) {
      // Never let brain-bus failures bubble back to the webhook
      // handler. Meta will retry the webhook if we 500; we don't
      // want a downstream brain consumer outage to trigger that.
      this.logger?.warn(
        {
          messageId: context.message.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'whatsapp-brain-emitter: emit failed (swallowed)',
      );
      return 0;
    }
  }

  // ============================================================================
  // Private — per-conversation-kind emission
  // ============================================================================

  private async emitDirect(
    context: WhatsAppInboundContext,
    tenantId: string,
    senderUserId: string | null,
    recipientUserId: string | undefined,
  ): Promise<number> {
    // CRITICAL: DMs stay DMs. ACL contains only sender + recipient.
    // Roles list is empty — DMs never grant role-based access.
    const userIds: string[] = [];
    if (senderUserId) userIds.push(senderUserId);
    if (recipientUserId && recipientUserId !== senderUserId) {
      userIds.push(recipientUserId);
    }

    const acl: BrainEventACL = {
      userIds: dedupe(userIds),
      roleIds: [],
    };

    const event = this.buildEvent({
      context,
      tenantId,
      actorUserId: senderUserId,
      acl,
      conversationKind: 'dm',
    });

    await this.publisher.publish(event);
    return 1;
  }

  private async emitGroup(
    context: WhatsAppInboundContext,
    tenantId: string,
    senderUserId: string | null,
  ): Promise<number> {
    // CRITICAL: group ACL = full member list captured AT WEBHOOK
    // TIME. Stale member lists = potential leak; we always
    // re-resolve.
    if (!context.groupId || !this.groupMembershipLookup) return 0;

    const members = await this.groupMembershipLookup.listMembers(
      context.groupId,
    );

    // Sender is implicitly a member, but defensive: include them so a
    // stale membership snapshot that has expunged the sender still
    // grants them read access to their own message.
    const userIds = senderUserId ? [...members, senderUserId] : [...members];

    const acl: BrainEventACL = {
      userIds: dedupe(userIds),
      roleIds: [],
    };

    const event = this.buildEvent({
      context,
      tenantId,
      actorUserId: senderUserId,
      acl,
      conversationKind: 'group',
    });

    await this.publisher.publish(event);
    return 1;
  }

  private async emitBroadcast(
    context: WhatsAppInboundContext,
    tenantId: string,
    senderUserId: string | null,
  ): Promise<number> {
    // CRITICAL: broadcast lists are sender-private. Recipients don't
    // see each other → fan out into N events with per-recipient ACL.
    if (!context.broadcastListId || !this.broadcastRecipientLookup) return 0;

    const recipients = await this.broadcastRecipientLookup.listRecipients(
      context.broadcastListId,
    );

    let emitted = 0;
    for (const recipient of recipients) {
      const userIds: string[] = [];
      if (senderUserId) userIds.push(senderUserId);
      if (recipient && recipient !== senderUserId) userIds.push(recipient);

      const acl: BrainEventACL = {
        userIds: dedupe(userIds),
        roleIds: [],
      };

      const event = this.buildEvent({
        context,
        tenantId,
        actorUserId: senderUserId,
        acl,
        conversationKind: 'broadcast',
      });

      await this.publisher.publish(event);
      emitted += 1;
    }
    return emitted;
  }

  // ============================================================================
  // Private — helpers
  // ============================================================================

  private async resolveSenderUserId(phoneNumber: string): Promise<string | null> {
    if (this.userResolver) {
      try {
        const resolved = await this.userResolver.resolveUserIdForPhone(phoneNumber);
        if (resolved) return resolved;
      } catch (error) {
        this.logger?.warn(
          {
            phoneNumber,
            err: error instanceof Error ? error.message : String(error),
          },
          'whatsapp-brain-emitter: userResolver failed; falling back to phone',
        );
      }
    }
    // Fallback: phone number IS the identity. Better than dropping
    // the event — downstream re-tag can join phone → user later.
    return phoneNumber || null;
  }

  private buildEvent(args: {
    context: WhatsAppInboundContext;
    tenantId: string;
    actorUserId: string | null;
    acl: BrainEventACL;
    conversationKind: 'dm' | 'group' | 'broadcast';
  }): BrainEvent {
    const { context, tenantId, actorUserId, acl, conversationKind } = args;
    const msg = context.message;

    // Best-effort observation time. Meta sends a unix-seconds string;
    // fall back to now() when malformed.
    const observedAt = parseTimestamp(msg.timestamp);

    const event: BrainEvent = {
      type: 'comms.whatsapp.inbound',
      tenantId,
      ...(actorUserId ? { actorId: actorUserId } : {}),
      payload: {
        messageId: msg.id,
        from: msg.from,
        senderName: context.senderName,
        type: msg.type,
        text: msg.text?.body,
        // Pass-through of all media + interactive fields so consumers
        // can deserialize without re-parsing the webhook payload.
        // Cast to Record<string, unknown> shape for the bus type.
        ...(msg.image ? { image: msg.image } : {}),
        ...(msg.audio ? { audio: msg.audio } : {}),
        ...(msg.document ? { document: msg.document } : {}),
        ...(msg.video ? { video: msg.video } : {}),
        ...(msg.location ? { location: msg.location } : {}),
        ...(msg.interactive ? { interactive: msg.interactive } : {}),
        ...(msg.button ? { button: msg.button } : {}),
        ...(msg.context ? { quotedContext: msg.context } : {}),
        conversationKind,
        ...(context.groupId ? { groupId: context.groupId } : {}),
        ...(context.broadcastListId
          ? { broadcastListId: context.broadcastListId }
          : {}),
      } as Readonly<Record<string, unknown>>,
      acl,
      observedAt,
      sourceSystem: 'whatsapp',
    };

    return event;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function dedupe(ids: ReadonlyArray<string>): ReadonlyArray<string> {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
}

function parseTimestamp(raw: string | undefined): Date {
  if (!raw) return new Date();
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1000);
}

/**
 * Factory function for composition root wiring.
 */
export function createWhatsAppBrainEmitter(
  options: WhatsAppBrainEmitterOptions,
): WhatsAppBrainEmitter {
  return new WhatsAppBrainEmitter(options);
}
