/**
 * Logger notifier — in-process fallback. Records the escalation in the
 * logger only; never fails. Used when no external channel is
 * configured, and as the graceful-degrade target for the other
 * adapters when their credentials are missing.
 */

import type { ResilienceLogger } from '../types.js';
import {
  formatUnrecoverableBody,
  type Notifier,
  type UnrecoverableNotice,
} from './notifier-interface.js';

export interface LoggerNotifierDeps {
  readonly logger: ResilienceLogger;
}

export function createLoggerNotifier(deps: LoggerNotifierDeps): Notifier {
  return {
    async notifyUnrecoverable(notice: UnrecoverableNotice) {
      deps.logger.error(
        {
          channel: 'logger',
          wave_id: notice.wave_id,
          attempts: notice.attempts,
          reason: notice.reason,
        },
        formatUnrecoverableBody(notice),
      );
      return true;
    },
  };
}
