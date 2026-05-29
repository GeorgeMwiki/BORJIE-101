/**
 * `borjie watch` — long-running daemon that subscribes to MCP-style
 * resource notifications (opportunities, risks, reminders, calibration
 * drift) via SSE. Each event is printed in human or JSON form. An
 * optional `--exec "cmd"` shells out per event.
 *
 *   $ borjie watch
 *   $ borjie watch --filter opportunities,risks
 *   $ borjie watch --exec 'osascript -e "display notification \"$BORJIE_EVENT_TITLE\""'
 *
 * Ctrl+C exits cleanly. The server endpoint is
 * `/api/v1/agent/notifications` (consumes the existing in-process
 * stream — graceful fallback if absent: long-poll
 * `/api/v1/agent/notifications/poll` every 5s).
 */

import { spawn } from 'node:child_process';
import { requireSession } from './_session.js';
import { HttpError } from '../http.js';
import type { BorjieLogger } from '../logger.js';

export async function watchCommand(opts: {
  readonly logger: BorjieLogger;
  readonly filter?: readonly string[];
  readonly exec?: string;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const filterSet = opts.filter ? new Set(opts.filter) : null;
  const banner = opts.logger.opts.json
    ? null
    : `Watching ${session.apiBaseUrl} (Ctrl+C to stop)…`;
  if (banner) opts.logger.info(banner);

  // Allow abort via either a passed signal or SIGINT.
  let aborted = false;
  const abortBag: Array<() => void> = [];
  const stop = (): void => {
    aborted = true;
    for (const fn of abortBag) {
      try {
        fn();
      } catch {
        /* best effort */
      }
    }
  };
  process.once('SIGINT', stop);
  opts.signal?.addEventListener('abort', stop, { once: true });

  try {
    for await (const evt of session.http.stream('/api/v1/agent/notifications', {
      method: 'GET',
    })) {
      if (aborted) break;
      if (filterSet && evt.event && !filterSet.has(evt.event)) continue;
      emit(opts.logger, evt.event ?? 'event', evt.data);
      if (opts.exec) await runHook(opts.exec, evt.event ?? 'event', evt.data, opts.logger);
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      // Fallback: long poll
      opts.logger.warn('SSE channel not available; falling back to long-poll mode.');
      await longPollLoop({
        logger: opts.logger,
        intervalMs: opts.pollIntervalMs ?? 5000,
        filterSet,
        ...(opts.exec ? { execCmd: opts.exec } : {}),
        isAborted: () => aborted,
      });
    } else {
      throw err;
    }
  } finally {
    process.removeListener('SIGINT', stop);
  }
}

function emit(logger: BorjieLogger, event: string, data: string): void {
  const parsed = tryParse(data);
  if (logger.opts.json) {
    logger.json({ event, data: parsed ?? data, ts: new Date().toISOString() });
    return;
  }
  const summary =
    parsed && typeof parsed === 'object'
      ? ((parsed as Record<string, unknown>)['title'] ??
        (parsed as Record<string, unknown>)['message'] ??
        '')
      : '';
  logger.raw(`[${new Date().toISOString()}] ${event}${summary ? `: ${summary}` : ''}`);
}

async function runHook(
  cmd: string,
  event: string,
  data: string,
  logger: BorjieLogger,
): Promise<void> {
  const parsed = tryParse(data);
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BORJIE_EVENT: event,
    BORJIE_EVENT_DATA: typeof data === 'string' ? data : JSON.stringify(data),
    BORJIE_EVENT_TITLE: extractField(parsed, 'title') ?? '',
  };
  try {
    const child = spawn(cmd, { shell: true, env, stdio: 'inherit' });
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  } catch (err) {
    logger.warn(`exec hook failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function longPollLoop(args: {
  readonly logger: BorjieLogger;
  readonly intervalMs: number;
  readonly filterSet: Set<string> | null;
  readonly execCmd?: string;
  readonly isAborted: () => boolean;
}): Promise<void> {
  const session = requireSession(args.logger);
  let cursor: string | undefined;
  while (!args.isAborted()) {
    try {
      const res = (await session.http.request<{
        events?: ReadonlyArray<{ event: string; data: unknown }>;
        cursor?: string;
      }>('/api/v1/agent/notifications/poll', {
        query: cursor !== undefined ? { cursor } : {},
      })) as {
        events?: ReadonlyArray<{ event: string; data: unknown }>;
        cursor?: string;
      } | undefined;
      const events = res?.events ?? [];
      for (const e of events) {
        if (args.filterSet && !args.filterSet.has(e.event)) continue;
        emit(args.logger, e.event, typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
        if (args.execCmd)
          await runHook(args.execCmd, e.event, JSON.stringify(e.data), args.logger);
      }
      if (res?.cursor) cursor = res.cursor;
    } catch {
      /* swallow + back off */
    }
    await sleep(args.intervalMs);
  }
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractField(parsed: unknown, key: string): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const v = (parsed as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
