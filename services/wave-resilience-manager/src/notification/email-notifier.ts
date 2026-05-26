/**
 * Email notifier — sends via Resend's REST API. Primary escalation
 * channel per founder decision #2 (corrected): internal chat is the
 * everyday surface; email is the async-reliable fallback when chat
 * can't reach the operator.
 *
 * Used when NOTIFICATION_CHANNEL=email. Graceful degrade: factory
 * falls back to logger-notifier if RESEND_API_KEY or OPERATOR_EMAIL
 * is missing.
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
  /**
   * Defaults to the Borjie notifications mailbox on the Resend-verified
   * `.co.tz` domain (see `Docs/SUPABASE_SETUP_STATUS.md`). Overridable
   * for tests.
   */
  readonly from?: string;
  readonly logger?: ResilienceLogger;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_FROM = 'notifications@borjie.co.tz';
const RESEND_URL = 'https://api.resend.com/emails';

function buildSubject(notice: UnrecoverableNotice): string {
  return `[Borjie] Wave ${notice.wave_id} unrecoverable after ${notice.attempts} attempts`;
}

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
            subject: buildSubject(notice),
            text: body,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          deps.logger?.warn(
            {
              channel: 'email',
              wave_id: notice.wave_id,
              status: res.status,
              body: errBody.slice(0, 256),
            },
            'email-notifier: resend rejected the message',
          );
          return false;
        }
        deps.logger?.info(
          {
            channel: 'email',
            wave_id: notice.wave_id,
            to: deps.to,
          },
          'email-notifier: escalation delivered',
        );
        return true;
      } catch (err) {
        return logAndSwallow(deps.logger, err, 'email', notice);
      }
    },
  };
}
