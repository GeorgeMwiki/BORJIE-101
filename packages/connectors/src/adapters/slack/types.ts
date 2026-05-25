/**
 * Slack adapter — public types module.
 *
 * Wave-2 task #11.3 in `.audit/litfin-sota-2026-05-23/00-EXECUTION-ROADMAP.md`.
 * Research report: `.audit/litfin-sota-2026-05-23/11-company-brain-primitive.md`.
 *
 * The Slack connector is the operator-team brain feed: where WhatsApp
 * captures ~85% of *tenant* communications in EA, Slack captures the
 * institutional knowledge of the *operator team* — decision flows
 * ("approved by James", "escalate to legal"), receipt-before-approve
 * patterns, vendor reliability calls, lease-renewal context, etc.
 *
 * Two non-negotiables (mirrored from the WhatsApp brain emitter and the
 * Onyx/Glean SOTA-2026 reference architecture):
 *
 *   1. **Tenant-scoped tokens.** Each tenant installs the BORJIE
 *      Slack app into their own workspace via per-tenant OAuth. Tokens
 *      and signing secrets are stored per-tenant; there is no
 *      platform-wide bot token. Cross-tenant fan-out is impossible by
 *      construction.
 *
 *   2. **Source-based ACL inheritance.** A Slack DM stays a DM
 *      (`userIds = [sender, recipient]`); a private channel stays
 *      private (`userIds = [...channel.members]`); a public channel
 *      grants tenant-wide read via `roleIds` (the tenant's
 *      "all-members" role). ACL is captured at ingest time alongside
 *      content — never post-filtered.
 *
 * This module deliberately does NOT import the canonical brain-bus
 * types from `@borjie/ai-copilot/brain-event-bus`. The connectors
 * package has zero `@borjie/*` workspace deps today; adding one
 * would balloon the install graph. Instead we duck-type the brain bus
 * contract locally — same shape, same field names, same semantics —
 * matching the pattern established by the WhatsApp brain emitter at
 * `services/notifications/src/whatsapp/brain/whatsapp-brain-emitter.ts`.
 *
 * IMPORTANT: keep these shapes in sync with the canonical types module
 * at `packages/ai-copilot/src/brain-event-bus/types.ts`. TS structural
 * typing makes the two trivially interop — any drift here is a bug.
 */

// ============================================================================
// Brain-bus duck types (mirror packages/ai-copilot/src/brain-event-bus/types.ts)
// ============================================================================

/** ACL envelope. Mirrors `BrainEventACL`. */
export interface BrainEventACL {
  readonly userIds: ReadonlyArray<string>;
  readonly roleIds: ReadonlyArray<string>;
}

/** Source system discriminator. Mirrors `BrainEventSource`. */
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

/** Brain event envelope. Mirrors `BrainEvent`. */
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

/** Publisher contract — minimal by design. */
export interface BrainEventPublisher {
  publish(event: BrainEvent): Promise<void>;
}

// ============================================================================
// Slack OAuth + token model
// ============================================================================

/**
 * Per-tenant Slack app install. Each property-management company
 * installs the BORJIE app into their own workspace; the OAuth
 * flow at `/v2/oauth.v2.access` returns these credentials which are
 * persisted by the platform's identity service (out of scope here).
 *
 * The adapter receives this struct at construction time. No tokens
 * are read from environment variables — tokens are always per-tenant.
 */
export interface SlackTenantInstall {
  /** BORJIE tenant id this install belongs to. */
  readonly tenantId: string;
  /**
   * Slack workspace (team) id, e.g. `T0123456`. Returned by
   * `oauth.v2.access` as `team.id`. Used as the install key.
   */
  readonly teamId: string;
  /**
   * Bot-scoped access token (`xoxb-...`). Used for `chat.postMessage`
   * and event-subscription introspection.
   */
  readonly botToken: string;
  /**
   * Per-install signing secret. Returned at app-distribution time;
   * used to verify event-subscription signatures (`X-Slack-Signature`).
   * NOT the same as the bot token — never send it on a wire.
   */
  readonly signingSecret: string;
  /**
   * Bot user id within the workspace, e.g. `U0BOT0001`. Used by
   * `events-handler` to suppress self-mentions / self-replies.
   */
  readonly botUserId?: string;
  /**
   * Token type discriminator. v1 only supports `bot` tokens; user
   * tokens (`xoxp-...`) are forward-looking for impersonation flows.
   */
  readonly tokenType?: 'bot' | 'user';
}

// ============================================================================
// Slack Web API — minimal request/response shapes
// ============================================================================

/** `chat.postMessage` input. Only the fields v1 needs. */
export interface SlackChatPostMessageInput {
  readonly channel: string;
  readonly text: string;
  /** Optional reply-in-thread parent timestamp (`ts`). */
  readonly thread_ts?: string;
  /** Optional Block Kit blocks JSON. */
  readonly blocks?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/** `chat.postMessage` success response. */
export interface SlackChatPostMessageOutput {
  readonly ok: true;
  readonly channel: string;
  /** Message timestamp — also serves as the message id within a channel. */
  readonly ts: string;
  readonly message?: Readonly<Record<string, unknown>>;
}

/** `users.info` response (subset). */
export interface SlackUserInfo {
  readonly id: string;
  readonly team_id: string;
  readonly name: string;
  readonly real_name?: string;
  readonly is_bot: boolean;
  readonly deleted: boolean;
  readonly profile?: {
    readonly email?: string;
    readonly real_name?: string;
    readonly display_name?: string;
  };
}

// ============================================================================
// Slack event-subscription payloads (minimal — v1 supports four types)
// ============================================================================

/**
 * Slack event-subscription envelope (the outer wrapper Slack POSTs to
 * the `/slack/events` endpoint). The discriminator field is `type`.
 *
 *   - `url_verification` — initial challenge handshake.
 *   - `event_callback` — every other event arrives wrapped in this.
 */
export type SlackEventEnvelope =
  | SlackUrlVerificationEnvelope
  | SlackEventCallbackEnvelope;

/** Initial challenge handshake — respond with `challenge` echoed back. */
export interface SlackUrlVerificationEnvelope {
  readonly type: 'url_verification';
  readonly token: string;
  readonly challenge: string;
}

/** All real events arrive wrapped in this envelope. */
export interface SlackEventCallbackEnvelope {
  readonly type: 'event_callback';
  readonly team_id: string;
  readonly api_app_id: string;
  readonly event: SlackEvent;
  /** Slack-assigned event id (idempotency key). */
  readonly event_id: string;
  /** Unix-second observation time at the workspace. */
  readonly event_time: number;
  /** Optional authed users list (deprecated by Slack but still sent). */
  readonly authed_users?: ReadonlyArray<string>;
}

/**
 * Inner event union. v1 supports the four event types listed in the
 * task scope:
 *
 *   - `message` (channel messages — surfaced for `message.channels`
 *     event-subscription scope)
 *   - `message` with `channel_type: 'im'` (direct messages — surfaced
 *     for `message.im` event-subscription scope)
 *   - `reaction_added`
 *   - `app_mention`
 *
 * Slack disambiguates `message.channels` vs `message.im` via the
 * `channel_type` field, NOT via a separate event type. We handle both
 * under the `message` discriminator and route via `channel_type`.
 */
export type SlackEvent =
  | SlackMessageEvent
  | SlackReactionAddedEvent
  | SlackAppMentionEvent;

/**
 * `message` event — fired on `message.channels`, `message.groups`,
 * `message.im`, `message.mpim` event-subscription scopes. The
 * `channel_type` field tells us which:
 *
 *   - `channel` — public channel (`message.channels`)
 *   - `group`   — private channel (`message.groups`)
 *   - `im`      — direct message (`message.im`)
 *   - `mpim`    — multi-person DM (`message.mpim`)
 */
export interface SlackMessageEvent {
  readonly type: 'message';
  /** Channel id, e.g. `C0123ABC` (public) / `G0123ABC` (private) / `D0123ABC` (DM). */
  readonly channel: string;
  /**
   * Sender user id. Optional because Slack sends bot messages with
   * `bot_id` instead of `user`; the events-handler skips bot messages.
   */
  readonly user?: string;
  /** Plain-text body. */
  readonly text?: string;
  /** Message timestamp = message id within channel. */
  readonly ts: string;
  /** Thread parent ts when this message is a thread reply. */
  readonly thread_ts?: string;
  /**
   * Channel-type discriminator. Tells the ACL resolver whether this
   * is a DM (`im`/`mpim`), a private channel (`group`), or a public
   * channel (`channel`).
   */
  readonly channel_type?: 'channel' | 'group' | 'im' | 'mpim';
  /** Set when this is a bot message — events-handler will skip. */
  readonly bot_id?: string;
  /**
   * Subtype — Slack uses this for `message_changed`, `message_deleted`,
   * `file_share`, etc. v1 only emits brain events for plain messages
   * (no subtype) and `file_share`.
   */
  readonly subtype?: string;
  /** Optional Block Kit blocks. */
  readonly blocks?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Workspace id (some payloads carry it inside the event too). */
  readonly team?: string;
}

/** `reaction_added` event. */
export interface SlackReactionAddedEvent {
  readonly type: 'reaction_added';
  /** The user adding the reaction. */
  readonly user: string;
  /** Emoji shortname, e.g. `+1`, `white_check_mark`. */
  readonly reaction: string;
  /** The user whose message was reacted to. */
  readonly item_user?: string;
  /** The target item — only `message` is supported in v1. */
  readonly item: {
    readonly type: 'message' | 'file' | 'file_comment';
    readonly channel: string;
    readonly ts: string;
  };
  /** Unix-second observation time. */
  readonly event_ts: string;
}

/** `app_mention` event — fires when @BORJIE-bot is mentioned. */
export interface SlackAppMentionEvent {
  readonly type: 'app_mention';
  readonly user: string;
  readonly text: string;
  readonly ts: string;
  readonly channel: string;
  readonly thread_ts?: string;
}

// ============================================================================
// ACL resolution contracts
// ============================================================================

/**
 * Information about a Slack channel needed to resolve its read-ACL.
 *
 *   - `kind`        — discriminates DM / group-DM / private / public.
 *   - `members`     — full member list for DM / group-DM / private.
 *                     Empty for public (use `tenantAllMembersRoleId`).
 *   - `isPublic`    — true for `channel` kind. The retriever expands
 *                     `roleIds` against live tenant membership.
 */
export interface SlackChannelACL {
  readonly kind: 'im' | 'mpim' | 'group' | 'channel';
  readonly members: ReadonlyArray<string>;
  readonly isPublic: boolean;
}

/**
 * Resolver contract: given a tenant + channel id, returns the
 * read-ACL. Implementations call `conversations.info` +
 * `conversations.members` against the per-tenant bot token. The
 * connector caller is responsible for caching.
 */
export interface SlackChannelACLResolver {
  resolve(args: {
    readonly tenantId: string;
    readonly channelId: string;
  }): Promise<SlackChannelACL>;
}

/**
 * Resolver contract: maps a Slack workspace user id (`U0123ABC`) to
 * the platform-internal BORJIE user id. Implementations typically
 * wrap a lookup by email (from `users.info.profile.email`) against
 * the tenant's identity service. When the lookup returns null the
 * connector falls back to `slack:<teamId>:<userId>` as the user id —
 * keeps the bus tracker honest while a downstream re-tag joins later.
 */
export interface SlackUserResolver {
  resolveUserId(args: {
    readonly tenantId: string;
    readonly slackUserId: string;
  }): Promise<string | null>;
}

// ============================================================================
// Signature verification
// ============================================================================

/**
 * Inputs needed to verify a Slack request signature. The Slack spec
 * defines the signature base string as:
 *
 *   v0:{timestamp}:{raw_body}
 *
 * and the signature header as `v0=<hex_hmac_sha256>`. See
 * https://api.slack.com/authentication/verifying-requests-from-slack.
 */
export interface SlackSignatureVerifyInput {
  /** Raw request body bytes (NOT JSON.parse'd — exact bytes matter). */
  readonly rawBody: string;
  /** `X-Slack-Signature` header value (`v0=<hex>`). */
  readonly signature: string;
  /** `X-Slack-Request-Timestamp` header value (unix seconds, decimal). */
  readonly timestamp: string;
  /** Per-tenant signing secret. */
  readonly signingSecret: string;
}

/** Outcome of a signature verification attempt. */
export type SlackSignatureVerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SlackSignatureVerifyFailReason };

export type SlackSignatureVerifyFailReason =
  | 'missing-signature'
  | 'missing-timestamp'
  | 'timestamp-skew'
  | 'malformed-signature'
  | 'mismatch';

// ============================================================================
// Decision-pattern miner
// ============================================================================

/**
 * Output of the decision-pattern miner: a recognised conversational
 * intent that the operator team has expressed in Slack. v1 only
 * recognises one intent — "approve after receipt" — which is the
 * canonical example from the SOTA-2026 research report (the "James
 * always asks for the maintenance receipt before approving" rule).
 *
 * Future intents land here as new literal members of the union.
 */
export type SlackRecognisedIntent =
  | 'approve-after-receipt'
  | 'escalate-to-legal'
  | 'request-quote'
  | 'unknown';

/** Single mined-pattern row. */
export interface SlackMinedPattern {
  /** Recognised intent name (or `unknown` when no pattern matched). */
  readonly intent: SlackRecognisedIntent;
  /**
   * Confidence in [0, 1]. v1 returns deterministic confidence based
   * on the keyword-match rules; future versions may return the
   * chi-squared-derived p-value. The miner stub-returns 1.0 for an
   * exact-match phrase and 0.0 for `unknown`.
   */
  readonly confidence: number;
  /**
   * The keyword(s) that triggered the match. Empty for `unknown`.
   * Useful for explaining the miner's decision to the operator.
   */
  readonly triggerKeywords: ReadonlyArray<string>;
  /**
   * Optional chi-squared statistic. The research report describes a
   * chi-squared significance test (≥ 3.841 = 95% confidence) over
   * trajectory features; v1 stub-returns a fixed value so consumers
   * can assert on the shape. Production implementation lives in
   * `packages/ai-copilot/src/learning-loop/pattern-extractor.ts`.
   */
  readonly chiSquared?: number;
}
