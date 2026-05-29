/**
 * `borjie reminders ls / add` — schedule and inspect reminders.
 */

import { randomUUID } from 'node:crypto';
import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function remindersLsCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/owner/reminders');
  opts.logger.json(res);
}

export async function remindersAddCommand(opts: {
  readonly logger: BorjieLogger;
  readonly text: string;
  readonly when: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const fireAt = new Date(opts.when);
  if (Number.isNaN(fireAt.getTime())) {
    opts.logger.error(`Invalid --when value: ${opts.when} (must be ISO-8601)`);
    process.exitCode = 1;
    return;
  }
  const res = await session.http.request<unknown>('/api/v1/owner/reminders', {
    method: 'POST',
    body: { text: opts.text, fireAt: fireAt.toISOString() },
    idempotencyKey: randomUUID(),
  });
  if (opts.logger.opts.json) opts.logger.json(res);
  else opts.logger.success(`Reminder scheduled for ${fireAt.toISOString()}`);
}
