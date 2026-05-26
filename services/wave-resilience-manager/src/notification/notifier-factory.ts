/**
 * Notifier factory — picks the right adapter based on the resolved
 * `NotificationChannel` config value (founder-locked default: `sms`).
 *
 * Graceful degrade: when the requested channel's credentials are
 * missing, the factory logs a warning and falls back to the
 * `logger-notifier`. The resilience manager never blocks an
 * escalation due to a missing channel — the audit row is still
 * written.
 */

import type {
  NotificationChannel,
  ResilienceManagerConfig,
} from '../config.js';
import type { ResilienceLogger } from '../types.js';
import { createEmailNotifier } from './email-notifier.js';
import { createLoggerNotifier } from './logger-notifier.js';
import type { Notifier } from './notifier-interface.js';
import { createSlackNotifier } from './slack-notifier.js';
import { createSmsNotifier, resolveTwilioCreds } from './sms-notifier.js';

export interface NotifierFactoryDeps {
  readonly config: ResilienceManagerConfig;
  readonly logger: ResilienceLogger;
  /** Override fetch for tests. */
  readonly fetchImpl?: typeof fetch;
}

export interface ResolvedNotifier {
  readonly notifier: Notifier;
  /** Channel actually wired (may differ from requested after degrade). */
  readonly channel: NotificationChannel;
  /** True iff the requested channel degraded to logger. */
  readonly degraded: boolean;
}

function buildSms(deps: NotifierFactoryDeps): ResolvedNotifier | null {
  if (resolveTwilioCreds(deps.config.twilio) === null) return null;
  return {
    notifier: createSmsNotifier({
      twilio: deps.config.twilio,
      logger: deps.logger,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    }),
    channel: 'sms',
    degraded: false,
  };
}

function buildSlack(deps: NotifierFactoryDeps): ResolvedNotifier | null {
  const url = deps.config.slackWebhookUrl;
  if (url === null) return null;
  return {
    notifier: createSlackNotifier({
      webhookUrl: url,
      logger: deps.logger,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    }),
    channel: 'slack',
    degraded: false,
  };
}

function buildEmail(deps: NotifierFactoryDeps): ResolvedNotifier | null {
  const { resendApiKey, operatorEmail } = deps.config;
  if (resendApiKey === null || operatorEmail === null) return null;
  return {
    notifier: createEmailNotifier({
      apiKey: resendApiKey,
      to: operatorEmail,
      logger: deps.logger,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    }),
    channel: 'email',
    degraded: false,
  };
}

function buildLogger(deps: NotifierFactoryDeps): ResolvedNotifier {
  return {
    notifier: createLoggerNotifier({ logger: deps.logger }),
    channel: 'logger',
    degraded: false,
  };
}

export function createNotifier(deps: NotifierFactoryDeps): ResolvedNotifier {
  const requested = deps.config.notificationChannel;
  let chosen: ResolvedNotifier | null = null;

  switch (requested) {
    case 'sms':
      chosen = buildSms(deps);
      break;
    case 'slack':
      chosen = buildSlack(deps);
      break;
    case 'email':
      chosen = buildEmail(deps);
      break;
    case 'logger':
      chosen = buildLogger(deps);
      break;
    default: {
      // Exhaustiveness guard. Type-system says this is unreachable.
      const _exhaustive: never = requested;
      void _exhaustive;
      chosen = null;
    }
  }

  if (chosen !== null) return chosen;

  deps.logger.warn(
    { requested },
    'notifier-factory: requested channel not configured — degrading to logger',
  );
  return { ...buildLogger(deps), degraded: true };
}
