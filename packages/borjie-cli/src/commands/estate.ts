/**
 * `borjie estate sites / workers` — surface the estate roll-ups.
 */

import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function estateSitesCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/mining/sites');
  opts.logger.json(res);
}

export async function estateWorkersCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/workforce');
  opts.logger.json(res);
}
