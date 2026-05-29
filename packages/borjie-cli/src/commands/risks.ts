/**
 * `borjie risks` — list active risks.
 */

import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function risksCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/owner/risks');
  opts.logger.json(res);
}
