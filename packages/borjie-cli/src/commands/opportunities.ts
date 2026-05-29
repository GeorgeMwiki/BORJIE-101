/**
 * `borjie opportunities` — list candidate opportunities.
 */

import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function opportunitiesCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/opportunities');
  opts.logger.json(res);
}
