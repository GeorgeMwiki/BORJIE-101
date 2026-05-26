/**
 * Calendar incremental poller.
 *
 * Routes by `provider`. Google uses `syncToken`; on 410 sync-token-reset
 * we surface `kind: 'sync-token-reset'` so the orchestrator can wipe
 * the cursor and trigger a full backfill on the next run.
 */

import type { GoogleCalendarClient } from '../client/google-cal-api.js';
import type { OutlookCalendarClient } from '../client/outlook-graph.js';
import type { CalendarNormaliser } from './normalizer.js';
import type {
  CalendarEvent,
  CalendarSyncRequest,
  CalendarSyncResult,
  Hasher,
} from '../types.js';

export interface CalendarPollerDeps {
  readonly google: GoogleCalendarClient;
  readonly outlook: OutlookCalendarClient;
  readonly normaliser: CalendarNormaliser;
  readonly hasher: Hasher;
  readonly maxRetries?: number;
  readonly baseBackoffMs?: number;
  /** ISO time window for Outlook calendarView. Defaults to ±30 days from now. */
  readonly windowStartIso?: string;
  readonly windowEndIso?: string;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;

export function createCalendarPoller(deps: CalendarPollerDeps) {
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseBackoff = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  const pollGoogle = async (
    req: CalendarSyncRequest,
  ): Promise<CalendarSyncResult> => {
    const res = await deps.google.events({
      accessToken: req.accessToken,
      calendarId: req.calendarId,
      syncToken: req.cursor,
      limit: req.maxItems,
    });
    if (res.kind !== 'ok') return res;

    const events: CalendarEvent[] = [];
    for (const e of res.events) {
      const body = `${req.tenantId}:google_calendar:${req.account}:${req.calendarId}:${e.id}`;
      const auditHash = await deps.hasher(body);
      const normalised = await deps.normaliser.normaliseGoogle({
        tenantId: req.tenantId,
        account: req.account,
        calendarId: req.calendarId,
        event: e,
        auditHash,
      });
      events.push(normalised);
    }
    return { kind: 'ok', events, nextCursor: res.nextSyncToken };
  };

  const pollOutlook = async (
    req: CalendarSyncRequest,
  ): Promise<CalendarSyncResult> => {
    const now = new Date();
    const windowStartIso =
      deps.windowStartIso ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const windowEndIso =
      deps.windowEndIso ?? new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();

    const res = await deps.outlook.events({
      accessToken: req.accessToken,
      calendarId: req.calendarId,
      cursor: req.cursor,
      windowStartIso,
      windowEndIso,
      limit: req.maxItems,
    });
    if (res.kind !== 'ok') return res;

    const events: CalendarEvent[] = [];
    for (const e of res.events) {
      const body = `${req.tenantId}:outlook_calendar:${req.account}:${req.calendarId}:${e.id}`;
      const auditHash = await deps.hasher(body);
      const normalised = await deps.normaliser.normaliseOutlook({
        tenantId: req.tenantId,
        account: req.account,
        calendarId: req.calendarId,
        event: e,
        auditHash,
      });
      events.push(normalised);
    }
    return { kind: 'ok', events, nextCursor: res.nextCursor };
  };

  return {
    poll: async (req: CalendarSyncRequest): Promise<CalendarSyncResult> => {
      let attempt = 0;
      let last: CalendarSyncResult | null = null;
      const pollFn = req.provider === 'google_calendar' ? pollGoogle : pollOutlook;
      while (attempt <= maxRetries) {
        const res = await pollFn(req);
        if (
          res.kind === 'ok' ||
          res.kind === 'rate-limited' ||
          res.kind === 'auth-failed' ||
          res.kind === 'sync-token-reset'
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

export type CalendarPoller = ReturnType<typeof createCalendarPoller>;
