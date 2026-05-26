/**
 * Slack notifier — POSTs to a Slack incoming-webhook URL. Used when
 * NOTIFICATION_CHANNEL=slack. Graceful degrade: factory falls back to
 * logger-notifier if SLACK_WEBHOOK_URL is missing.
 *
 * Contract: never throws.
 */

import type { ResilienceLogger } from '../types.js';
import {
  formatUnrecoverableBody,
  logAndSwallow,
  type Notifier,
  type UnrecoverableNotice,
} from './notifier-interface.js';

export interface SlackNotifierDeps {
  readonly webhookUrl: string;
  readonly logger?: ResilienceLogger;
  readonly fetchImpl?: typeof fetch;
}

export function createSlackNotifier(deps: SlackNotifierDeps): Notifier {
  const fetchImpl: typeof fetch = deps.fetchImpl ?? fetch;
  return {
    async notifyUnrecoverable(notice: UnrecoverableNotice) {
      const text = formatUnrecoverableBody(notice);
      try {
        const res = await fetchImpl(deps.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          deps.logger?.warn(
            {
              channel: 'slack',
              wave_id: notice.wave_id,
              status: res.status,
            },
            'slack-notifier: webhook rejected',
          );
          return false;
        }
        return true;
      } catch (err) {
        return logAndSwallow(deps.logger, err, 'slack', notice);
      }
    },
  };
}
