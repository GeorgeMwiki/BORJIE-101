/**
 * Default trigger sink — logs the trigger via the worker logger.
 *
 * Real deployments swap in a notification adapter (in-app push,
 * email, WhatsApp, etc.) one layer up at the composition root. The
 * log sink keeps tests + dev usable without notification plumbing.
 */
import type { TriggerSink, WorkerLogger } from '../types.js';

export interface CreateLogSinkArgs {
  readonly logger: WorkerLogger;
}

/**
 * Build a {@link TriggerSink} that just logs each trigger.
 */
export function createLogSink(args: CreateLogSinkArgs): TriggerSink {
  return {
    emit({ tenantId, userId, role, trigger }) {
      args.logger.info(
        {
          tenantId,
          userId,
          role,
          triggerId: trigger.id,
          kind: trigger.kind,
          urgency: trigger.urgency,
          summary: trigger.summary,
        },
        'proactive-triggers-worker: trigger fired',
      );
    },
  };
}
