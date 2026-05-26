/**
 * Slack cursor-based incremental poller.
 *
 * Walks `conversations.history` via the injected `SlackWebClient`.
 * On `429`, surfaces `rate-limited` to the caller; on `auth-failed`,
 * surfaces the failure so the auth broker can refresh. Exponential
 * retry on `upstream-error`/`transport-error` is up to 3 attempts
 * with jitter; after exhaustion, the result kind is bubbled up.
 *
 * Idempotent: running with the same cursor twice yields the same
 * message stream (Slack's `oldest`/`cursor` are stable). The
 * normaliser produces fresh `id`s each call (uuid v4), so dedup
 * happens at the SQL `UNIQUE(tenant_id, workspace_id, channel_id, ts)`
 * boundary.
 */

import type { SlackWebClient } from '../client/slack-web.js';
import type { SlackNormaliser } from './normalizer.js';
import type {
  Hasher,
  SlackMessage,
  SlackSyncRequest,
  SlackSyncResult,
} from '../types.js';

export interface SlackPollerDeps {
  readonly client: SlackWebClient;
  readonly normaliser: SlackNormaliser;
  readonly hasher: Hasher;
  readonly maxRetries?: number;
  readonly baseBackoffMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;

export function createSlackPoller(deps: SlackPollerDeps) {
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseBackoff = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  return {
    poll: async (req: SlackSyncRequest): Promise<SlackSyncResult> => {
      let attempt = 0;
      let lastError: SlackSyncResult | null = null;

      while (attempt <= maxRetries) {
        const res = await deps.client.history({
          accessToken: req.accessToken,
          channelId: req.channelId,
          cursor: req.cursor,
          limit: req.maxItems,
        });

        if (res.kind === 'ok') {
          const messages: SlackMessage[] = [];
          for (const apiMsg of res.messages) {
            const body = `${req.tenantId}:${req.workspaceId}:${req.channelId}:${apiMsg.ts}:${apiMsg.text ?? ''}`;
            const auditHash = await deps.hasher(body);
            const normalised = await deps.normaliser.normalise({
              tenantId: req.tenantId,
              workspaceId: req.workspaceId,
              channelId: req.channelId,
              apiMessage: apiMsg,
              auditHash,
              attachmentStorageKeys: new Map<string, string>(),
            });
            messages.push(normalised);
          }
          return {
            kind: 'ok',
            messages,
            nextCursor: res.nextCursor,
          };
        }

        if (res.kind === 'rate-limited' || res.kind === 'auth-failed') {
          return res;
        }

        // upstream-error / transport-error → retry with exponential backoff + jitter.
        lastError = res;
        if (attempt === maxRetries) break;
        const sleepMs = baseBackoff * 2 ** attempt + Math.floor(Math.random() * baseBackoff);
        await sleep(sleepMs);
        attempt += 1;
      }
      return lastError ?? { kind: 'transport-error', message: 'retries exhausted' };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type SlackPoller = ReturnType<typeof createSlackPoller>;
