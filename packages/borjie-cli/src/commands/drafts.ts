/**
 * `borjie drafts ls / new / lock / show` — document drafts.
 */

import { randomUUID } from 'node:crypto';
import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

interface DraftListItem {
  readonly id: string;
  readonly title?: string;
  readonly classification?: string;
  readonly updatedAt?: string;
  readonly [key: string]: unknown;
}

export async function draftsLsCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<{ success: boolean; data: readonly DraftListItem[] }>(
    '/api/v1/owner/drafts',
  );
  emitTabular(opts.logger, res?.data ?? [], ['id', 'title', 'classification', 'updatedAt']);
}

export async function draftsNewCommand(opts: {
  readonly logger: BorjieLogger;
  readonly template?: string;
  readonly intent?: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  if (!opts.intent && !opts.template) {
    opts.logger.error('Provide --intent "<text>" or --template <name>');
    process.exitCode = 1;
    return;
  }
  const body = opts.intent
    ? { intent: opts.intent }
    : { templateSlug: opts.template };
  const res = await session.http.request<{ success: boolean; data?: unknown }>(
    '/api/v1/owner/drafts/free-form',
    {
      method: 'POST',
      body,
      idempotencyKey: randomUUID(),
    },
  );
  opts.logger.json(res);
}

export async function draftsLockCommand(opts: {
  readonly logger: BorjieLogger;
  readonly id: string;
  readonly reason?: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<{ success: boolean }>(
    `/api/v1/owner/drafts/${encodeURIComponent(opts.id)}/lock`,
    {
      method: 'POST',
      body: { reason: opts.reason ?? 'finalized' },
      idempotencyKey: randomUUID(),
    },
  );
  if (opts.logger.opts.json) opts.logger.json(res);
  else opts.logger.success(`Locked draft ${opts.id}.`);
}

export async function draftsShowCommand(opts: {
  readonly logger: BorjieLogger;
  readonly id: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>(
    `/api/v1/owner/drafts/${encodeURIComponent(opts.id)}`,
  );
  opts.logger.json(res);
}

function emitTabular<T extends Record<string, unknown>>(
  logger: BorjieLogger,
  rows: readonly T[],
  cols: readonly string[],
): void {
  if (logger.opts.json) {
    logger.json(rows);
    return;
  }
  if (rows.length === 0) {
    logger.info('(no rows)');
    return;
  }
  logger.raw(cols.join('\t'));
  for (const row of rows) {
    logger.raw(cols.map((c) => formatCell(row[c])).join('\t'));
  }
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
