/**
 * `borjie scope` — print the scope taxonomy + selected nodes.
 */

import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function scopeCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/scope');
  opts.logger.json(res);
}
