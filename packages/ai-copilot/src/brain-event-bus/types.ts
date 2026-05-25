/**
 * Brain Event Bus — types module.
 *
 * The company-brain primitive (Wave-2 task #10 of
 * `.audit/litfin-sota-2026-05-23/00-EXECUTION-ROADMAP.md`, research
 * report `11-company-brain-primitive.md`) ingests scattered tenant
 * communications into a single, ACL-tagged event stream.
 *
 * Two non-negotiable design constraints derived from the SOTA-2026
 * landscape (Onyx, Glean, Notion, Microsoft Graph Connectors):
 *
 *   1. **ACL is ingested AT THE SAME TIME as content** — never
 *      post-filtered. Glean / Onyx call this "permission-aware
 *      ingestion": a DM stays a DM, a private channel never leaks via
 *      answer aggregation. This module's `BrainEventACL` mirrors that
 *      contract: every event carries the full set of (userIds + roleIds)
 *      that may read it, captured at emit time from the source system.
 *
 *   2. **Tenant isolation is mandatory** — every event carries a
 *      `tenantId`. The bus rejects events with empty tenant ids in
 *      strict mode and logs+drops in lenient mode (used for tests).
 *      Cross-tenant fan-out is impossible by construction.
 *
 * This module deliberately does NOT pull in `@borjie/observability`'s
 * `EventBus`. The platform's domain-event bus is shaped for
 * aggregate-root DDD events (PaymentReceived, LeaseTerminated) — the
 * brain bus is shaped for **communication ingestion**: stream-like,
 * ACL-first, with a different read model (per-user / per-role).
 * Re-using the observability bus would have meant grafting ACL onto a
 * shape that was never meant to carry it. Keeping the surfaces
 * separate is the cleaner long-term split.
 *
 * Onyx ACL pattern reference:
 *   https://docs.onyx.app/overview/core_features/connectors
 *   "Permission-aware ingestion — every connector ingests ACL metadata
 *    at the same time as content. The retriever filters at query time
 *    using the asking user's ACL graph."
 *
 * Glean Skills ACL reference:
 *   https://www.glean.com/blog/glean-skills-launch-2026
 *   "Source-based ACL inheritance is non-negotiable."
 */

// ============================================================================
// ACL — permission envelope for a single brain event
// ============================================================================

/**
 * Access-control envelope carried by every brain event.
 *
 * The set of (userIds, roleIds) is the **closed-world** list of
 * principals that may read this event. Empty `userIds` + empty
 * `roleIds` is intentionally NOT a wildcard — it means **no-one** can
 * read the event and the event is effectively quarantined. Use this
 * for content the system ingested but cannot yet attribute (e.g. an
 * unknown sender on an inbound webhook) so the data lands but stays
 * un-readable until a downstream re-tag step resolves the identity.
 *
 * Public events (e.g. tenant-wide announcements) are modelled by
 * including the tenant's "all-members" roleId (resolved by the source
 * connector) in `roleIds`, NOT by leaving both lists empty.
 */
export interface BrainEventACL {
  /**
   * Explicit user ids permitted to read this event.
   *
   * For WhatsApp DMs: `[senderUserId, recipientUserId]`.
   * For WhatsApp groups: `[allGroupMemberUserIds...]` resolved at
   * webhook time (NEVER lazily — late ACL resolution = stale ACL).
   * For Slack: `[channel.members...]` for private channels;
   *   `[tenant.allMembersRoleId]` via `roleIds` for `#general` etc.
   */
  readonly userIds: ReadonlyArray<string>;
  /**
   * Role ids permitted to read this event.
   *
   * Roles are resolved by the consumer side against the tenant's
   * identity service (`@borjie/identity`). The bus does NOT
   * expand role membership at emit time — that would push stale
   * snapshots into the event log. The consumer/retriever expands
   * `roleIds` against live membership at query time.
   */
  readonly roleIds: ReadonlyArray<string>;
}

// ============================================================================
// Source-system enum
// ============================================================================

/**
 * Communication channel the event originated from.
 *
 * The list is extensible — additional sources land here as new
 * connectors come online. The string-literal union forces every
 * consumer to handle the discriminator explicitly (TS exhaustiveness
 * checking) so a new source can't silently bypass downstream routing.
 */
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

// ============================================================================
// Core event shape
// ============================================================================

/**
 * The single envelope every connector emits onto the brain bus.
 *
 * Field shape mirrors the company-brain research report's
 * `Event(source, actorId, tenantId, payload, ts)` plus ACL — the
 * minimum metadata needed to (a) route to consumers, (b) reconstruct
 * the conversation thread, (c) enforce read-time permission checks.
 */
export interface BrainEvent<TPayload = Readonly<Record<string, unknown>>> {
  /**
   * Event type, dot-namespaced.
   *
   * Convention: `<domain>.<sub-system>.<verb>` — e.g.
   *   - `comms.whatsapp.inbound`
   *   - `comms.whatsapp.outbound`
   *   - `comms.slack.message.posted`
   *   - `payment.mpesa.received`
   *   - `system.connector.health.degraded`
   */
  readonly type: string;
  /**
   * Tenant id. **Mandatory.** Cross-tenant events do not exist.
   * The bus rejects events with empty tenant ids in strict mode.
   */
  readonly tenantId: string;
  /**
   * Sender / acting principal, when known. Resolved by the connector
   * from the source system's user id (e.g. WhatsApp `wa_id` →
   * BORJIE user id via `TenantLookup.findByPhone`). When the
   * sender is anonymous or unresolved, `actorId` is omitted and the
   * event is quarantined via empty ACL.
   */
  readonly actorId?: string;
  /**
   * Entity referenced by this event, when known. For an inbound
   * maintenance message this would be the `propertyId` or `unitId`;
   * for a payment event it would be the `leaseId` or `paymentId`.
   * Used by the work-graph indexer to attach the event to a node.
   */
  readonly subjectId?: string;
  /**
   * Source-specific payload. Connectors define their own shape; the
   * bus is intentionally type-agnostic. Consumers narrow via the
   * `type` discriminator + a runtime guard.
   */
  readonly payload: TPayload;
  /**
   * ACL envelope. **Mandatory.** Ingested at the same time as
   * content — never post-filtered. See `BrainEventACL` jsdoc.
   */
  readonly acl: BrainEventACL;
  /**
   * Wall-clock observation time at the source system. NOT the
   * webhook-received time — that goes in metadata.
   */
  readonly observedAt: Date;
  /**
   * Source-system discriminator. Used for routing + audit.
   */
  readonly sourceSystem: BrainEventSource;
}

// ============================================================================
// Subscriber / publisher contracts
// ============================================================================

/**
 * Async handler for a brain event. Consumers register one handler
 * per subscription pattern. Handlers MUST be idempotent — the bus
 * may re-deliver an event after a transient failure.
 */
export type BrainEventHandler = (event: BrainEvent) => Promise<void>;

/**
 * Publisher contract — used by connectors emitting events.
 *
 * The contract is intentionally minimal: a single `publish` method
 * that returns a Promise resolving once the event has been
 * accepted (NOT processed — handlers run async). This matches the
 * observability bus's contract and keeps the connector-side code
 * trivial.
 */
export interface BrainEventPublisher {
  publish(event: BrainEvent): Promise<void>;
}

/**
 * Subscriber contract — used by consumers (e.g.
 * consolidation-worker) registering handlers.
 *
 * Subscriptions are keyed by exact type match for v1. Pattern matching
 * (`comms.whatsapp.*`) is a deliberate v2 deferral — the platform's
 * observability `EventBus` already implements wildcard routing if a
 * consumer needs it; for the brain bus we want every consumer to be
 * explicit about the exact event types it consumes (auditable).
 */
export interface BrainEventSubscriber {
  subscribe(type: string, handler: BrainEventHandler): BrainEventSubscription;
}

/**
 * Subscription handle returned by `subscribe`. Calling `.unsubscribe()`
 * removes the handler.
 */
export interface BrainEventSubscription {
  readonly id: string;
  readonly type: string;
  unsubscribe(): void;
}

/**
 * Full bus surface — most implementations satisfy both publisher and
 * subscriber roles. The split exists so connectors can be wired with
 * only the publisher (least-privilege) and consumers with only the
 * subscriber.
 */
export interface BrainEventBus extends BrainEventPublisher, BrainEventSubscriber {}
