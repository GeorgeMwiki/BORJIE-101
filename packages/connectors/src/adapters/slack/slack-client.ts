/**
 * Slack Web API client — Bolt-style thin wrapper around the connector
 * framework. Exposes the minimum surface v1 needs:
 *
 *   - `oauthV2Access`    — exchange an authorization `code` for a
 *                          workspace install. Used by the per-tenant
 *                          OAuth installer in the operator console.
 *   - `chatPostMessage`  — outbound channel/DM/thread reply.
 *   - `usersInfo`        — fetch a user's profile (email, real name).
 *                          Drives `SlackUserResolver` lookups.
 *   - `conversationsInfo` — channel metadata (kind, is_private).
 *   - `conversationsMembers` — full member list (paginated). Drives
 *                          `SlackChannelACLResolver` for private
 *                          channels / multi-person DMs.
 *
 * The client composes through `createBaseConnector` so it inherits the
 * platform's rate-limit (Slack publishes ~1 req/sec for `chat.*`),
 * circuit-breaker, retry, audit, and event-emission discipline.
 *
 * Tenant-scoped tokens: the client takes a `SlackTenantInstall` at
 * construction time. There is NO platform-wide bot token; the
 * composition root creates one client per tenant install. This is the
 * direct mirror of the "per-tenant Slack app install" requirement in
 * the task scope.
 *
 * The Slack Web API uses `application/x-www-form-urlencoded` for most
 * legacy methods but accepts `application/json` for Bolt-era methods
 * (chat.postMessage, conversations.*, users.info all support JSON).
 * We use JSON for everything so the connector base's existing
 * Content-Type handling works without surgery.
 *
 * Slack quirks worth surfacing:
 *
 *   - Slack returns HTTP 200 even on logical failures. The success
 *     discriminator is the `ok` field in the response body. We
 *     translate `ok: false` into an `upstream-error` outcome so the
 *     caller doesn't have to unpack the envelope themselves.
 *
 *   - Rate-limit responses carry HTTP 429 + `Retry-After` header.
 *     The connector base's circuit breaker treats 429 as a 4xx (no
 *     retry); we explicitly DO NOT silently retry rate-limited
 *     requests because the per-tenant ratelimit is shared across all
 *     of the tenant's BORJIE workloads.
 *
 *   - `users.info` for a deleted user returns `{ ok: true, user: { deleted: true, ... } }`.
 *     The caller checks `deleted` — we surface the raw shape.
 */

import {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type ConnectorEventSink,
  type ConnectorOutcome,
} from '../../base-connector.js';
import type {
  SlackChatPostMessageInput,
  SlackChatPostMessageOutput,
  SlackTenantInstall,
  SlackUserInfo,
} from './types.js';

// ============================================================================
// Slack Web API base URL
// ============================================================================

/**
 * Slack's Web API root. Overridable per-instance for tests (any
 * `https://*.slack.test` works against the mock fetch).
 */
const DEFAULT_BASE_URL = 'https://slack.com/api';

// ============================================================================
// OAuth v2 — used by the per-tenant install flow
// ============================================================================

/** Input for `oauth.v2.access`. */
export interface SlackOauthV2AccessInput {
  /** Slack-issued client id for the BORJIE app. */
  readonly clientId: string;
  /** Slack-issued client secret. NEVER ship to the browser. */
  readonly clientSecret: string;
  /** The `code` query parameter Slack redirected back with. */
  readonly code: string;
  /** Optional redirect URI override (must match app configuration). */
  readonly redirectUri?: string;
}

/** Subset of the `oauth.v2.access` response we care about. */
export interface SlackOauthV2AccessOutput {
  readonly ok: true;
  /** Workspace id (used as the install key). */
  readonly team: { readonly id: string; readonly name?: string };
  /** App id within Slack. */
  readonly app_id?: string;
  /** Bot user id within the workspace. */
  readonly bot_user_id?: string;
  /** The `xoxb-...` bot token. */
  readonly access_token: string;
  /** Scopes granted, comma-separated. */
  readonly scope?: string;
  /** Optional refresh token (only set when token rotation is enabled). */
  readonly refresh_token?: string;
  /** Optional expiry (seconds since unix epoch). */
  readonly expires_in?: number;
}

// ============================================================================
// Conversations — used for ACL resolution
// ============================================================================

/** `conversations.info` response (subset). */
export interface SlackConversationInfo {
  readonly id: string;
  readonly name?: string;
  readonly is_channel?: boolean;
  readonly is_group?: boolean;
  readonly is_im?: boolean;
  readonly is_mpim?: boolean;
  readonly is_private?: boolean;
  /** True for `#general` / public channels — implies tenant-wide read. */
  readonly is_general?: boolean;
}

/** `conversations.members` response (paginated). */
export interface SlackConversationMembersPage {
  readonly members: ReadonlyArray<string>;
  readonly response_metadata?: { readonly next_cursor?: string };
}

// ============================================================================
// Client surface
// ============================================================================

export interface SlackClientDeps {
  /** Per-tenant install. Tokens NEVER come from environment vars. */
  readonly install: SlackTenantInstall;
  /** Optional base URL override (tests). */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface SlackClient {
  readonly connector: BaseConnector;
  readonly install: SlackTenantInstall;

  oauthV2Access(
    input: SlackOauthV2AccessInput,
  ): Promise<ConnectorOutcome<SlackOauthV2AccessOutput>>;

  chatPostMessage(
    input: SlackChatPostMessageInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<SlackChatPostMessageOutput>>;

  usersInfo(userId: string): Promise<ConnectorOutcome<{ readonly ok: true; readonly user: SlackUserInfo }>>;

  conversationsInfo(
    channelId: string,
  ): Promise<ConnectorOutcome<{ readonly ok: true; readonly channel: SlackConversationInfo }>>;

  conversationsMembers(
    channelId: string,
    cursor?: string,
  ): Promise<ConnectorOutcome<{ readonly ok: true } & SlackConversationMembersPage>>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Construct a per-tenant Slack client.
 *
 * The returned client carries the install on `client.install` so the
 * brain-event emitter (which needs `tenantId`) can pull it without a
 * second lookup.
 */
export function createSlackClient(deps: SlackClientDeps): SlackClient {
  const { install } = deps;
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;

  if (!install.tenantId || !install.teamId || !install.botToken) {
    throw new Error(
      'createSlackClient: install must carry tenantId + teamId + botToken (per-tenant OAuth)',
    );
  }

  const connector = createBaseConnector({
    config: {
      id: `slack:${install.teamId}`,
      displayName: `Slack (${install.teamId})`,
      baseUrl,
      auth: {
        kind: 'bearer',
        // Bot token is bound at construction; no refresh in v1.
        // Token rotation lands in a follow-up when the per-tenant
        // installer stores refresh tokens too.
        token: async () => install.botToken,
      },
      // Slack publishes ~1 req/sec for chat.* (Tier 3) and 50/min for
      // conversations.* (Tier 2). Pick the lower bound — the
      // connector caller can override per-tenant if their workspace
      // has elevated limits.
      rateLimit: { rpm: 50, burst: 10 },
      // Slack edge can flap; open the circuit after 5 errors with a
      // 30s cool-down.
      circuitBreaker: { errorThreshold: 5, halfOpenAfterMs: 30_000 },
      // 5xx retry budget. 429 short-circuits via `ok: false` body.
      retry: { maxAttempts: 3, initialDelayMs: 250 },
      timeoutMs: 15_000,
    },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  /**
   * Slack returns HTTP 200 + `{ ok: false, error: '...' }` on logical
   * failures. Translate that into a connector-shaped `upstream-error`
   * outcome so callers don't have to re-implement the envelope check.
   *
   * The generic is keyed on the success-branch type `T`. We accept
   * the union `T | SlackErrorBody` from the connector call and narrow
   * via the `ok` discriminator. The explicit cast on the success
   * branch is safe because the discriminator was just verified.
   */
  function unwrap<T extends { readonly ok: true }>(
    outcome: ConnectorOutcome<T | { ok: false; error?: string }>,
  ): ConnectorOutcome<T> {
    if (outcome.kind !== 'ok') return outcome as ConnectorOutcome<T>;
    const body = outcome.data;
    if (body.ok === false) {
      const message = typeof body.error === 'string' ? body.error : 'unknown error';
      return {
        kind: 'upstream-error',
        status: 200,
        message: `slack: ${message}`,
      };
    }
    // Narrowed: body is T. Cast retains attempt + latencyMs.
    return {
      kind: 'ok',
      data: body as T,
      latencyMs: outcome.latencyMs,
      attempt: outcome.attempt,
    };
  }

  async function oauthV2Access(
    input: SlackOauthV2AccessInput,
  ): Promise<ConnectorOutcome<SlackOauthV2AccessOutput>> {
    // OAuth uses form-encoded body and does NOT require auth — the
    // client_id + client_secret are the auth. We pass the body
    // through `query` so the base connector builds the URL correctly,
    // then send an empty POST body. Slack's `oauth.v2.access` accepts
    // both query and form.
    const outcome = await connector.call<undefined, SlackOauthV2AccessOutput | { ok: false; error?: string }>({
      path: '/oauth.v2.access',
      method: 'POST',
      query: {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
      },
    });
    return unwrap(outcome);
  }

  async function chatPostMessage(
    input: SlackChatPostMessageInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<SlackChatPostMessageOutput>> {
    const outcome = await connector.call<
      SlackChatPostMessageInput,
      SlackChatPostMessageOutput | { ok: false; error?: string }
    >({
      path: '/chat.postMessage',
      method: 'POST',
      body: input,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    return unwrap(outcome);
  }

  async function usersInfo(
    userId: string,
  ): Promise<ConnectorOutcome<{ readonly ok: true; readonly user: SlackUserInfo }>> {
    const outcome = await connector.call<
      undefined,
      { ok: true; user: SlackUserInfo } | { ok: false; error?: string }
    >({
      path: '/users.info',
      method: 'GET',
      query: { user: userId },
    });
    return unwrap(outcome);
  }

  async function conversationsInfo(
    channelId: string,
  ): Promise<ConnectorOutcome<{ readonly ok: true; readonly channel: SlackConversationInfo }>> {
    const outcome = await connector.call<
      undefined,
      { ok: true; channel: SlackConversationInfo } | { ok: false; error?: string }
    >({
      path: '/conversations.info',
      method: 'GET',
      query: { channel: channelId },
    });
    return unwrap(outcome);
  }

  async function conversationsMembers(
    channelId: string,
    cursor?: string,
  ): Promise<ConnectorOutcome<{ readonly ok: true } & SlackConversationMembersPage>> {
    const outcome = await connector.call<
      undefined,
      ({ ok: true } & SlackConversationMembersPage) | { ok: false; error?: string }
    >({
      path: '/conversations.members',
      method: 'GET',
      query: {
        channel: channelId,
        ...(cursor ? { cursor } : {}),
        limit: 200,
      },
    });
    return unwrap(outcome);
  }

  return {
    connector,
    install,
    oauthV2Access,
    chatPostMessage,
    usersInfo,
    conversationsInfo,
    conversationsMembers,
  };
}
