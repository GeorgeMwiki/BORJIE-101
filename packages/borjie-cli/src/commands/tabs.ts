/**
 * `borjie tabs ls / open` — owner-cockpit tab inventory.
 */

import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function tabsLsCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/owner/workforce');
  opts.logger.json(res);
}

export async function tabsOpenCommand(opts: {
  readonly logger: BorjieLogger;
  readonly id: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>(
    `/api/v1/owner/workforce/${encodeURIComponent(opts.id)}`,
  );
  opts.logger.json(res);
}
