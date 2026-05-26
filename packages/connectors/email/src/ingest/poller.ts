/**
 * Email cursor-based incremental poller.
 *
 * Routes by `provider` field. Gmail walks the list/get pair; Outlook
 * walks the list endpoint which already returns full message bodies.
 *
 * The poller is provider-agnostic at the result shape — it returns
 * canonical `EmailMessage` rows so downstream code never branches
 * on provider after the boundary.
 */

import type { GmailClient } from '../client/gmail.js';
import type { OutlookGraphClient } from '../client/outlook-graph.js';
import type { EmailNormaliser } from './normalizer.js';
import type {
  EmailMessage,
  EmailSyncRequest,
  EmailSyncResult,
  Hasher,
} from '../types.js';

export interface EmailPollerDeps {
  readonly gmail: GmailClient;
  readonly outlook: OutlookGraphClient;
  readonly normaliser: EmailNormaliser;
  readonly hasher: Hasher;
  readonly maxRetries?: number;
  readonly baseBackoffMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;

export function createEmailPoller(deps: EmailPollerDeps) {
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseBackoff = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  const pollOnce = async (
    req: EmailSyncRequest,
  ): Promise<EmailSyncResult> => {
    if (req.provider === 'gmail') return pollGmail(req);
    return pollOutlook(req);
  };

  const pollGmail = async (
    req: EmailSyncRequest,
  ): Promise<EmailSyncResult> => {
    const list = await deps.gmail.list({
      accessToken: req.accessToken,
      labels: req.labels,
      cursor: req.cursor,
      limit: req.maxItems,
    });
    if (list.kind !== 'ok') return list;

    const messages: EmailMessage[] = [];
    for (const id of list.messageIds) {
      const detail = await deps.gmail.get({ accessToken: req.accessToken, messageId: id });
      if (detail.kind !== 'ok') return detail;
      const body = `${req.tenantId}:gmail:${req.account}:${detail.message.id}`;
      const auditHash = await deps.hasher(body);
      const normalised = await deps.normaliser.normaliseGmail({
        tenantId: req.tenantId,
        account: req.account,
        message: detail.message,
        auditHash,
      });
      messages.push(normalised);
    }
    return { kind: 'ok', messages, nextCursor: list.nextCursor };
  };

  const pollOutlook = async (
    req: EmailSyncRequest,
  ): Promise<EmailSyncResult> => {
    const list = await deps.outlook.list({
      accessToken: req.accessToken,
      categories: req.labels,
      cursor: req.cursor,
      limit: req.maxItems,
    });
    if (list.kind !== 'ok') return list;

    const messages: EmailMessage[] = [];
    for (const m of list.messages) {
      const body = `${req.tenantId}:outlook_mail:${req.account}:${m.id}`;
      const auditHash = await deps.hasher(body);
      const normalised = await deps.normaliser.normaliseOutlook({
        tenantId: req.tenantId,
        account: req.account,
        message: m,
        auditHash,
      });
      messages.push(normalised);
    }
    return { kind: 'ok', messages, nextCursor: list.nextCursor };
  };

  return {
    poll: async (req: EmailSyncRequest): Promise<EmailSyncResult> => {
      let attempt = 0;
      let last: EmailSyncResult | null = null;
      while (attempt <= maxRetries) {
        const res = await pollOnce(req);
        if (
          res.kind === 'ok' ||
          res.kind === 'rate-limited' ||
          res.kind === 'auth-failed'
        ) {
          return res;
        }
        last = res;
        if (attempt === maxRetries) break;
        const sleepMs = baseBackoff * 2 ** attempt + Math.floor(Math.random() * baseBackoff);
        await sleep(sleepMs);
        attempt += 1;
      }
      return last ?? { kind: 'transport-error', message: 'retries exhausted' };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type EmailPoller = ReturnType<typeof createEmailPoller>;
