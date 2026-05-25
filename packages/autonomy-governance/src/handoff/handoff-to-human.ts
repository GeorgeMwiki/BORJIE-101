/**
 * Handoff-to-human facade.
 *
 * When the auto-rollback fires `handoff` or `kill-and-rollback`, the
 * in-flight work is queued for a human via this surface. The intent of
 * this module is to keep the producer-side ergonomic — callers say
 * "handoff this", not "construct a HandoffQueueEntry then enqueue it".
 */

import type { HandoffQueueEntry } from '../types.js';
import type { HandoffQueuePort } from '../slo/auto-rollback.js';

export interface HandoffRequest {
  readonly subMd: string;
  readonly tenantId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly priority?: HandoffQueueEntry['priority'];
}

export interface HandoffDeps {
  readonly queue: HandoffQueuePort;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export async function handoffToHuman(
  request: HandoffRequest,
  deps: HandoffDeps,
): Promise<HandoffQueueEntry> {
  const now = (deps.now ?? (() => new Date()))();
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  const entry: HandoffQueueEntry = Object.freeze({
    id: newId(),
    subMd: request.subMd,
    tenantId: request.tenantId,
    originalRequest: request.payload,
    reason: request.reason,
    queuedAt: now.toISOString(),
    priority: request.priority ?? 'P2',
    status: 'queued',
  });

  await deps.queue.enqueue(entry);
  return entry;
}
