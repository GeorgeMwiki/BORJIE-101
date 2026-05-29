/**
 * `borjie share <entity-type> <id>` — generate a share link.
 */

import { randomUUID } from 'node:crypto';
import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function shareCommand(opts: {
  readonly logger: BorjieLogger;
  readonly entityType: string;
  readonly id: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const res = await session.http.request<unknown>('/api/v1/public/share', {
    method: 'POST',
    body: { entityType: opts.entityType, entityId: opts.id },
    idempotencyKey: randomUUID(),
  });
  opts.logger.json(res);
}
