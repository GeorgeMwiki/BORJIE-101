/**
 * Email notifier — sends via Resend's REST API. Used when
 * NOTIFICATION_CHANNEL=email. Graceful degrade: factory falls back to
 * logger-notifier if RESEND_API_KEY or OPERATOR_EMAIL is missing.
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

export interface EmailNotifierDeps {
  readonly apiKey: string;
  readonly to: string;
  /** Defaults to a Borjie alerts mailbox; overridable for tests. */
  readonly from?: string;
  readonly logger?: ResilienceLogger;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_FROM = 'alerts@borjie.com';
const RESEND_URL = 'https://api.resend.com/emails';

export function createEmailNotifier(deps: EmailNotifierDeps): Notifier {
  const fetchImpl: typeof fetch = deps.fetchImpl ?? fetch;
  const from = deps.from ?? DEFAULT_FROM;
  return {
    async notifyUnrecoverable(notice: UnrecoverableNotice) {
      const body = formatUnrecoverableBody(notice);
      try {
        const res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${deps.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: deps.to,
            subject: `[Borjie] Wave ${notice.wave_id} unrecoverable`,
            text: body,
          }),
        });
        if (!res.ok) {
          deps.logger?.warn(
            {
              channel: 'email',
              wave_id: notice.wave_id,
              status: res.status,
            },
            'email-notifier: resend rejected the message',
          );
          return false;
        }
        return true;
      } catch (err) {
        return logAndSwallow(deps.logger, err, 'email', notice);
      }
    },
  };
}
