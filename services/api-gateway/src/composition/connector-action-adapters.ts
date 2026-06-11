/**
 * connector-action-adapters — the REAL outbound action implementations the
 * connector invokers dispatch to.
 *
 * Each adapter is a pure async function over `(credential, input, fetchImpl)`
 * that performs ONE declared connector action against the live provider with
 * the tenant's decrypted token. Adapters are registered per connector id +
 * action id in `CONNECTOR_ACTION_ADAPTERS`; the invoker wiring
 * (`connector-invokers-wiring.ts`) drives dispatch generically from that map.
 *
 * HONESTY: an adapter is only registered for actions the provider genuinely
 * exposes. We do NOT fabricate an action a connector cannot perform — a catalog
 * action with no adapter here surfaces a structured `ConnectorActionError` (the
 * fabric maps it to `invoker_error`), never a faked success.
 *
 * Today only Slack ships real outbound adapters (its package + the Slack Web API
 * support auth.test / chat.postMessage / conversations.history). The registry is
 * the generative seam: a 22nd connector that ships a real adapter is picked up
 * with zero wiring changes.
 *
 * The plaintext token is read from `credential.accessToken` and used ONLY in the
 * provider Authorization header — it is never logged, never returned.
 */

import { z } from 'zod';

import type { DecryptedCredential } from './connector-invokers-wiring.js';

// ─────────────────────────────────────────────────────────────────────
// Typed errors the fabric already maps to its honest envelopes
// ─────────────────────────────────────────────────────────────────────

/**
 * Thrown when the calling tenant has no usable credential for a connector.
 * The fabric's `invoke` wraps invoker throws into `invoker_error`; this typed
 * subclass lets the wiring distinguish a not-connected from a provider failure
 * and keeps the message free of secret material.
 */
export class ConnectorNotConnectedError extends Error {
  public override readonly name = 'ConnectorNotConnectedError';
  constructor(
    public readonly connectorId: string,
    reason: string,
  ) {
    super(`connector '${connectorId}' not connected: ${reason}`);
  }
}

/** Thrown when a provider action fails (bad input, provider error, unknown action). */
export class ConnectorActionError extends Error {
  public override readonly name = 'ConnectorActionError';
  constructor(
    public readonly connectorId: string,
    reason: string,
  ) {
    super(reason);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Adapter contract
// ─────────────────────────────────────────────────────────────────────

export interface ConnectorActionContext {
  readonly credential: DecryptedCredential;
  readonly input: Readonly<Record<string, unknown>>;
  readonly fetchImpl: typeof fetch;
  readonly tenantId: string;
  readonly actorId: string;
}

export type ConnectorActionAdapter = (
  ctx: ConnectorActionContext,
) => Promise<unknown>;

// ─────────────────────────────────────────────────────────────────────
// Slack — real Web API adapters
// ─────────────────────────────────────────────────────────────────────

const SLACK_API_BASE = 'https://slack.com/api';

interface SlackOk {
  readonly ok: boolean;
  readonly error?: string;
  readonly [k: string]: unknown;
}

/**
 * Call a Slack Web API method with the bot token. Returns the parsed payload
 * on `ok:true`; throws `ConnectorActionError` on transport / `ok:false`. The
 * token rides in the Authorization header only.
 */
async function slackCall(
  ctx: ConnectorActionContext,
  method: string,
  body: Record<string, unknown> | null,
): Promise<SlackOk> {
  let res: Response;
  try {
    res = await ctx.fetchImpl(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.credential.accessToken}`,
        'content-type': 'application/json; charset=utf-8',
        accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new ConnectorActionError(
      'slack',
      `transport error calling ${method}: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }
  if (!res.ok) {
    throw new ConnectorActionError(
      'slack',
      `Slack ${method} HTTP ${res.status}`,
    );
  }
  let payload: SlackOk;
  try {
    payload = (await res.json()) as SlackOk;
  } catch {
    throw new ConnectorActionError('slack', `Slack ${method} non-JSON body`);
  }
  if (payload.ok !== true) {
    const error = typeof payload.error === 'string' ? payload.error : 'unknown';
    // invalid_auth / token_revoked mean the stored credential is no longer
    // usable — surface as not-connected so the tenant is told to reconnect.
    if (
      error === 'invalid_auth' ||
      error === 'token_revoked' ||
      error === 'not_authed' ||
      error === 'account_inactive'
    ) {
      throw new ConnectorNotConnectedError(
        'slack',
        `provider rejected the stored token (${error})`,
      );
    }
    throw new ConnectorActionError('slack', `Slack ${method} failed: ${error}`);
  }
  return payload;
}

/** connection.test → auth.test (read-only liveness + identity probe). */
const slackConnectionTest: ConnectorActionAdapter = async (ctx) => {
  const payload = await slackCall(ctx, 'auth.test', null);
  return Object.freeze({
    ok: true,
    connectorId: 'slack',
    team: typeof payload.team === 'string' ? payload.team : undefined,
    teamId: typeof payload.team_id === 'string' ? payload.team_id : undefined,
    botUserId:
      typeof payload.user_id === 'string' ? payload.user_id : undefined,
    scopes: ctx.credential.scopes,
  });
};

const SlackPostInput = z.object({
  channel: z
    .string()
    .min(1)
    .max(256)
    .describe('Channel id (C...) or name the bot is a member of.'),
  text: z.string().min(1).max(40_000).describe('Message text to post.'),
  threadTs: z
    .string()
    .max(64)
    .optional()
    .describe('Optional parent message ts to reply in-thread.'),
});

/** message.post → chat.postMessage (egress write). */
const slackMessagePost: ConnectorActionAdapter = async (ctx) => {
  const parsed = SlackPostInput.safeParse(ctx.input);
  if (!parsed.success) {
    throw new ConnectorActionError(
      'slack',
      `invalid message.post input: ${
        parsed.error.issues[0]?.message ?? 'bad input'
      }`,
    );
  }
  const { channel, text, threadTs } = parsed.data;
  const payload = await slackCall(ctx, 'chat.postMessage', {
    channel,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  return Object.freeze({
    ok: true,
    posted: true,
    connectorId: 'slack',
    channel: typeof payload.channel === 'string' ? payload.channel : channel,
    ts: typeof payload.ts === 'string' ? payload.ts : undefined,
  });
};

const SlackPullInput = z.object({
  channel: z.string().min(1).max(256).describe('Channel id to read history of.'),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().max(512).optional(),
});

/** sync.pull → conversations.history (read; bounded page). */
const slackSyncPull: ConnectorActionAdapter = async (ctx) => {
  const parsed = SlackPullInput.safeParse(ctx.input);
  if (!parsed.success) {
    throw new ConnectorActionError(
      'slack',
      `invalid sync.pull input: ${
        parsed.error.issues[0]?.message ?? 'bad input'
      }`,
    );
  }
  const { channel, limit, cursor } = parsed.data;
  const payload = await slackCall(ctx, 'conversations.history', {
    channel,
    limit: limit ?? 50,
    ...(cursor ? { cursor } : {}),
  });
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as ReadonlyArray<Record<string, unknown>>)
    : [];
  const metadata = payload.response_metadata as
    | { next_cursor?: string }
    | undefined;
  return Object.freeze({
    ok: true,
    connectorId: 'slack',
    messageCount: messages.length,
    nextCursor:
      metadata && typeof metadata.next_cursor === 'string' && metadata.next_cursor !== ''
        ? metadata.next_cursor
        : null,
  });
};

// ─────────────────────────────────────────────────────────────────────
// The registry — generative dispatch seam
// ─────────────────────────────────────────────────────────────────────

/**
 * Per-connector action adapter map. The invoker wiring binds an invoker for a
 * connector ONLY when it appears here (a real adapter ships) AND its provider
 * env gate passes. Adding a connector's adapters here (plus its env gate + a
 * catalog row) lights it up end-to-end with zero route/tool change.
 */
export const CONNECTOR_ACTION_ADAPTERS: Readonly<
  Record<string, Readonly<Record<string, ConnectorActionAdapter>>>
> = Object.freeze({
  slack: Object.freeze({
    'connection.test': slackConnectionTest,
    'message.post': slackMessagePost,
    'sync.pull': slackSyncPull,
  }),
});
