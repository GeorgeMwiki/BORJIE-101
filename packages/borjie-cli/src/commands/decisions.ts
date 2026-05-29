/**
 * `borjie decisions ls / show` — decision journal.
 */

import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function decisionsLsCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/decisions');
  opts.logger.json(res);
}

export async function decisionsShowCommand(opts: {
  readonly logger: BorjieLogger;
  readonly id: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>(
    `/api/v1/decisions/${encodeURIComponent(opts.id)}`,
  );
  opts.logger.json(res);
}
