/**
 * Twilio SMS notifier — primary escalation channel per founder decision
 * #2. POSTs to Twilio's Messages API using Basic auth (account SID +
 * auth token). No Twilio SDK dependency: a single endpoint via the
 * Node 18+ global `fetch`.
 *
 * Graceful degrade: if any Twilio env value is missing, the factory
 * falls back to the logger-notifier — see `notifier-factory.ts`. This
 * adapter assumes all four creds are present (callers must check).
 *
 * Contract: never throws. Logs + swallows on transport / HTTP / parse
 * failures.
 */

import type { TwilioConfig } from '../config.js';
import type { ResilienceLogger } from '../types.js';
import {
  formatUnrecoverableBody,
  logAndSwallow,
  type Notifier,
  type UnrecoverableNotice,
} from './notifier-interface.js';

export interface SmsNotifierDeps {
  readonly twilio: TwilioConfig;
  readonly logger?: ResilienceLogger;
  /** Override the global fetch — primarily for tests. */
  readonly fetchImpl?: typeof fetch;
}

export interface ResolvedTwilioCreds {
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;
  readonly operatorNumber: string;
}

/**
 * Returns the resolved creds if all four required values are present,
 * otherwise null. Centralised so the factory + tests + the adapter
 * itself all agree on what "configured" means.
 */
export function resolveTwilioCreds(
  twilio: TwilioConfig,
): ResolvedTwilioCreds | null {
  const { accountSid, authToken, fromNumber, operatorNumber } = twilio;
  if (
    accountSid === null ||
    authToken === null ||
    fromNumber === null ||
    operatorNumber === null
  ) {
    return null;
  }
  return { accountSid, authToken, fromNumber, operatorNumber };
}

function buildTwilioUrl(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
}

function buildBasicAuthHeader(accountSid: string, authToken: string): string {
  const raw = `${accountSid}:${authToken}`;
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

export function createSmsNotifier(deps: SmsNotifierDeps): Notifier {
  const resolved = resolveTwilioCreds(deps.twilio);
  if (resolved === null) {
    // This branch should not be reached when the factory is used —
    // the factory checks `resolveTwilioCreds` first and degrades to
    // the logger-notifier. We keep the runtime guard so direct
    // construction is still safe.
    return {
      async notifyUnrecoverable(notice) {
        deps.logger?.warn(
          { wave_id: notice.wave_id },
          'sms-notifier: twilio creds missing — escalation NOT sent over SMS',
        );
        return false;
      },
    };
  }

  const fetchImpl: typeof fetch = deps.fetchImpl ?? fetch;
  const url = buildTwilioUrl(resolved.accountSid);
  const authHeader = buildBasicAuthHeader(
    resolved.accountSid,
    resolved.authToken,
  );

  return {
    async notifyUnrecoverable(notice: UnrecoverableNotice) {
      const body = formatUnrecoverableBody(notice);
      const form = new URLSearchParams({
        To: resolved.operatorNumber,
        From: resolved.fromNumber,
        Body: body,
      });

      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          deps.logger?.warn(
            {
              channel: 'sms',
              wave_id: notice.wave_id,
              status: res.status,
              body: text.slice(0, 256),
            },
            'sms-notifier: twilio rejected the message',
          );
          return false;
        }

        deps.logger?.info(
          {
            channel: 'sms',
            wave_id: notice.wave_id,
            to: resolved.operatorNumber,
          },
          'sms-notifier: escalation delivered',
        );
        return true;
      } catch (err) {
        return logAndSwallow(deps.logger, err, 'sms', notice);
      }
    },
  };
}
